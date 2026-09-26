(function () {
  'use strict';
  var section = document.getElementById('did-you-mean');
  if (!section) return;
  var API = window.ItBlogSearch;
  if (!API || typeof API.fuzzyMatch !== 'function') return;
  var parts = String(window.location.pathname || '').split('/').filter(Boolean);
  if (!parts.length) return;
  var slug = parts[parts.length - 1].toLowerCase();
  fetch('/assets/search-index.json', { credentials: 'omit' })
    .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
    .then(function (data) { return API.fuzzyMatch(slug, (data && data.posts) || [], 3); })
    .then(function (cands) {
      if (!cands || !cands.length) return;
      var list = section.querySelector('[data-candidates]');
      if (!list) return;
      list.innerHTML = cands.map(function (p) {
        var url = p.url || ('/posts/' + p.slug + '/');
        var title = p.title || p.slug;
        return '<li><a href="' + url + '">' + title + '</a></li>';
      }).join('');
      section.hidden = false;
    })
    .catch(function () { /* 静默:不显示候选 */ });
})();