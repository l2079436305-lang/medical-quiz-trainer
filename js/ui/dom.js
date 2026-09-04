/* =========================================================================
 * ui/dom.js — DOM 小工具
 * ========================================================================= */

(function (root) {
  'use strict';

  function $(sel, el) { return (el || document).querySelector(sel); }
  function $$(sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function el(tag, attrs, html) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!attrs.hasOwnProperty(k)) continue;
        if (k === 'class') node.className = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.indexOf('on') === 0 && typeof attrs[k] === 'function') node.addEventListener(k.slice(2), attrs[k]);
        else node.setAttribute(k, attrs[k]);
      }
    }
    if (html !== undefined && html !== null) node.innerHTML = html;
    return node;
  }

  function show(node) { node.classList.remove('hidden'); }
  function hide(node) { node.classList.add('hidden'); }

  function toast(msg, kind) {
    var box = $('#toast');
    if (!box) {
      box = el('div', { id: 'toast' });
      document.body.appendChild(box);
    }
    box.textContent = msg;
    box.className = 'toast show' + (kind ? ' toast-' + kind : '');
    clearTimeout(box._t);
    box._t = setTimeout(function () { box.className = 'toast'; }, 2600);
  }

  function confirmBox(msg) { return window.confirm(msg); }

  root.MQDom = { $: $, $$: $$, esc: esc, el: el, show: show, hide: hide, toast: toast, confirmBox: confirmBox };

})(typeof window !== 'undefined' ? window : globalThis);
