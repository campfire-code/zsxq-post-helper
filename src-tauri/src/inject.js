// 注入到知识星球窗口的脚本。
// 发帖的每一步都在这个页面里完成：用页面自己的登录状态调用网页版自己的接口，
// 只把结果里必要的几个字段（星球编号与名称、图片编号、帖子编号）回传给应用主窗口。
// 不读取、不回传 Cookie，不保存任何登录凭证，也不转发平台返回的其他用户信息。
(function () {
  if (window.__campfire) return;
  if (!/(^|\.)zsxq\.com$/.test(location.hostname)) return;
  var API = 'https://api.zsxq.com/v2';
  var rawFetch = window.fetch.bind(window);
  var sniffOn = false;

  function emit(event, payload) {
    try {
      window.__TAURI_INTERNALS__.invoke('plugin:event|emit', { event: event, payload: payload });
    } catch (e) {}
  }
  // 帖子、图片编号有 17 位，超过 JS 数字的精确范围，先把 15 位以上的 *_id 数字变成字符串再解析
  function parse(text) {
    return JSON.parse(text.replace(/("[a-z_]*_id"\s*:\s*)(\d{15,})/g, '$1"$2"'));
  }
  async function readJson(res) {
    var text = await res.text();
    if (res.status === 401 || res.status === 403) throw new Error('未登录或登录已过期，请在知识星球窗口里重新扫码');
    var data;
    try { data = parse(text); } catch (e) { throw new Error('平台返回的不是预期格式（HTTP ' + res.status + '），可能已改版'); }
    if (!data || !data.succeeded) throw new Error('平台拒绝了请求（错误码 ' + (data && data.code != null ? data.code : res.status) + '）');
    return data.resp_data || {};
  }
  function api(path, init) {
    return rawFetch(API + path, Object.assign({ credentials: 'include' }, init)).then(readJson);
  }
  function run(id, work) {
    Promise.resolve().then(work).then(
      function (data) { emit('zs-result', { id: id, ok: true, data: data }); },
      function (e) { emit('zs-result', { id: id, ok: false, error: String((e && e.message) || e) }); }
    );
  }
  function currentGroupId() {
    var m = /\/groups?\/(\d{6,})/.exec(location.pathname + location.hash);
    return m ? m[1] : '';
  }

  // 可选：只记录发往 zsxq.com 的请求的方法、路径（不含参数）和状态码，用来在平台改版后排查
  var rawOpen = XMLHttpRequest.prototype.open;
  function note(method, url, status) {
    if (!sniffOn) return;
    try {
      var u = new URL(url, location.href);
      if (/(^|\.)zsxq\.com$/.test(u.hostname)) emit('zs-net', { method: String(method || 'GET').toUpperCase(), path: u.hostname + u.pathname, status: status });
    } catch (e) {}
  }
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : input && input.url;
    var method = (init && init.method) || (input && input.method) || 'GET';
    var p = rawFetch.apply(window, arguments);
    p.then(function (r) { note(method, url, r.status); }, function () { note(method, url, 0); });
    return p;
  };
  XMLHttpRequest.prototype.open = function (m, url) {
    var self = this;
    this.addEventListener('loadend', function () { note(m, url, self.status); });
    return rawOpen.apply(this, arguments);
  };

  window.__campfire = {
    /** 连通检查：窗口是否在 zsxq.com，以及当前页面所在的星球编号 */
    ping: function (id) {
      run(id, async function () { return { host: location.hostname, groupId: currentGroupId() }; });
    },
    /** 读取我加入的星球（编号与名称） */
    groups: function (id) {
      run(id, async function () {
        var r = await api('/groups');
        if (!Array.isArray(r.groups)) throw new Error('没有读到星球列表（平台返回结构变了？），可以改用「使用窗口当前星球」');
        return r.groups.map(function (g) { return { id: String(g.group_id), name: String(g.name || '') }; });
      });
    },
    /** 窗口当前打开的星球 */
    currentGroup: function (id) {
      run(id, async function () {
        var gid = currentGroupId();
        if (!gid) throw new Error('窗口里现在不在某个星球页面，请先在知识星球窗口里点进要发帖的星球');
        var r = await api('/groups/' + gid);
        return { id: gid, name: String((r.group && r.group.name) || '') };
      });
    },
    /** 上传一张图片（base64），返回图片编号：先向知识星球申请上传凭证，再直传到它给的上传地址 */
    uploadImage: function (id, b64, mime) {
      run(id, async function () {
        var bin = atob(b64), bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        var blob = new Blob([bytes], { type: mime });
        var t = await api('/uploads', {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify({ req_data: { type: 'image', size: blob.size, name: '', hash: '' } }),
        });
        var domain = t.upload_zone && t.upload_zone.domains && t.upload_zone.domains[0];
        if (!t.upload_token || !domain) throw new Error('没有拿到上传凭证（平台返回结构变了？）');
        var form = new FormData();
        form.append('token', t.upload_token);
        form.append('file', blob, 'image.' + (mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1] || 'png'));
        var up = await rawFetch('https://' + domain + '/', { method: 'POST', body: form });
        var r = await readJson(up);
        if (!r.image_id) throw new Error('上传成功但没有返回图片编号（平台返回结构变了？）');
        return { imageId: String(r.image_id) };
      });
    },
    /** 发布一篇图文帖，返回帖子编号 */
    createTopic: function (id, groupId, text, imageIds) {
      run(id, async function () {
        if (!/^\d+$/.test(groupId)) throw new Error('星球编号不对');
        for (var i = 0; i < imageIds.length; i++) if (!/^\d+$/.test(imageIds[i])) throw new Error('图片编号不对');
        // 编号超出 JS 精确范围，请求体手工拼，保证原样发出
        var body = '{"req_data":{"type":"topic","text":' + JSON.stringify(text) + ',"image_ids":[' + imageIds.join(',') + '],"mentioned_user_ids":[]}}';
        var r = await api('/groups/' + groupId + '/topics', { method: 'POST', headers: { 'Content-Type': 'application/json;charset=utf-8' }, body: body });
        var tid = r.topic && r.topic.topic_id;
        if (!tid) throw new Error('平台没有返回帖子编号，帖子可能没有发出，请到星球里确认');
        return { topicId: String(tid) };
      });
    },
    /** 开关接口记录（默认关） */
    sniff: function (id, on) {
      sniffOn = !!on;
      run(id, async function () { return { on: sniffOn }; });
    },
  };
  emit('zs-status', { step: 'injected', host: location.hostname });
})();
