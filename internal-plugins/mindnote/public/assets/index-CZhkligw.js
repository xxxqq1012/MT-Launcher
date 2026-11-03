import { n as e, r as t, t as n } from './vendor-B5Pwgdm9.js'
import { n as r, r as i } from './markdown-DjJ5lgg2.js'
;(function () {
  let e = document.createElement(`link`).relList
  if (e && e.supports && e.supports(`modulepreload`)) return
  for (let e of document.querySelectorAll(`link[rel="modulepreload"]`)) n(e)
  new MutationObserver((e) => {
    for (let t of e)
      if (t.type === `childList`)
        for (let e of t.addedNodes) e.tagName === `LINK` && e.rel === `modulepreload` && n(e)
  }).observe(document, { childList: !0, subtree: !0 })
  function t(e) {
    let t = {}
    return (
      e.integrity && (t.integrity = e.integrity),
      e.referrerPolicy && (t.referrerPolicy = e.referrerPolicy),
      e.crossOrigin === `use-credentials`
        ? (t.credentials = `include`)
        : e.crossOrigin === `anonymous`
          ? (t.credentials = `omit`)
          : (t.credentials = `same-origin`),
      t
    )
  }
  function n(e) {
    if (e.ep) return
    e.ep = !0
    let n = t(e)
    fetch(e.href, n)
  }
})()
function a(e) {
  let t = `hljs-theme`,
    n = document.getElementById(t)
  ;(n || ((n = document.createElement(`style`)), (n.id = t), document.head.appendChild(n)),
    (n.textContent = e === `dark` ? r : i))
}
;(a(document.documentElement.getAttribute(`data-theme`) || `light`),
  new MutationObserver(() => {
    a(document.documentElement.getAttribute(`data-theme`) || `light`)
  }).observe(document.documentElement, { attributes: !0, attributeFilter: [`data-theme`] }))
var o = t(n)
;(o.use(e()), o.mount(`#app`))
