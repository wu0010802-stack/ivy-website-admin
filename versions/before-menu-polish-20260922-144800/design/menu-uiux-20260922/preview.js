const params = new URLSearchParams(location.search);
const direction = ['a', 'b', 'c'].includes(params.get('v')) ? params.get('v') : 'a';
document.body.dataset.direction = direction;
if (params.has('embed')) document.body.classList.add('embedded');
const origin = 'https://web-production-04caa.up.railway.app';
const asset = '../../web/public/assets/';
const panel = document.querySelector('#menu-panel');
const toggle = document.querySelector('.toggle');
const titles = { a: 'A · 墨綠精簡', b: 'B · 米白目錄', c: 'C · 校園優先' };
document.title = titles[direction] + '｜常春藤導覽提案';
document.querySelector('#direction-label').textContent = titles[direction];
const icon = name => `<svg class="icon" aria-hidden="true"><use href="icons.svg#i-${name}"></use></svg>`;
const link = (href, content, className = '') => `<a class="${className}" href="${origin}${href}" target="_blank" rel="noopener">${content}</a>`;
const navItems = [
  ['關於常春藤', 'About Ivy', '/#about'],
  ['孩子的一天', 'A Day at Ivy', '/#life'],
  ['五所校園', 'Our Campuses', '/#campuses'],
  ['最新消息', 'Latest News', '/#latest-news'],
];
const navigation = () => `<nav class="primary-nav" aria-label="主要導覽">${navItems.map(([zh, en, href], i) => link(href, `<span class="nav-number" aria-hidden="true">0${i + 1}</span><span class="nav-copy"><strong>${zh}</strong><small lang="en">${en}</small></span>${icon('arrow-right')}`, 'nav-item')).join('')}</nav>`;
const campusLinks = () => `<div class="campus-section"><div class="section-head"><h2>找到你的校園</h2><span>高雄・五個成長起點</span></div><nav class="campus-links" aria-label="分校導覽">${window.menuCampuses.map(c => link('/campuses/' + c.key, `<strong>${c.name}</strong><small>${c.district}</small>`, 'campus-link')).join('')}</nav></div>`;
const phone = (c, className = 'phone-block') => `<a class="${className}" href="tel:${c.phone}" aria-label="致電${c.name} ${c.phone}"><span class="phone-icon">${icon('phone')}</span><span><small>${c.name}・參觀專線</small><strong>${c.phone}</strong></span>${icon('arrow-up-right')}</a>`;
const campusChannels = c => `<nav class="branch-socials" aria-label="${c.name}社群">${[['instagram', 'IG'], ['facebook', 'FB'], ['youtube', 'YouTube'], ['line', 'LINE']].map(([platform, label]) => {
  const url = c[platform] && c[platform].replace(/\/+$/, '') !== 'https://www.facebook.com/ivykid' ? c[platform] : null;
  const content = `${icon(platform)}<span>${label}</span><small>${url ? '前往 ↗' : '待提供'}</small>`;
  return url ? `<a class="branch-social" href="${url}" target="_blank" rel="noopener noreferrer" aria-label="${c.name} ${label}（另開新視窗）">${content}</a>` : `<span class="branch-social is-pending">${content}</span>`;
}).join('')}</nav>`;
const schoolDetail = c => `<div class="school-photo"><img src="${asset}${c.image}.webp" alt="${c.name}校園" width="590" height="300"><span class="photo-label">${icon('map-pin')}${c.district}</span></div><div class="school-copy"><div class="school-title"><h2>${c.name}</h2>${link('/campuses/' + c.key, '認識校園 ' + icon('arrow-right'), 'school-more')}</div><p>${c.address.replace('高雄市', '')}</p><div class="school-actions">${phone(c, 'school-phone')}${link('/visit/' + c.key, '預約這所校園 ' + icon('arrow-right'), 'school-book')}</div></div>`;

if (direction === 'a') {
  panel.innerHTML = `<div class="panel-intro"><h1>探索常春藤</h1><span class="intro-line"></span></div>${navigation()}${campusLinks()}${phone(window.menuCampuses[0])}`;
} else if (direction === 'b') {
  panel.innerHTML = `<div class="panel-intro"><h1>探索常春藤</h1><span class="intro-line" aria-hidden="true"></span></div>${navigation()}${campusLinks()}<div class="branch-contact">${phone(window.menuCampuses[0])}${campusChannels(window.menuCampuses[0])}</div><div class="institution-socials"><span>機構社群</span><a href="https://www.facebook.com/ivykid" target="_blank" rel="noopener noreferrer">${icon('facebook')}機構粉絲專頁${icon('arrow-up-right')}</a></div>`;
} else {
  panel.innerHTML = `<div class="panel-intro"><div><h1>找到孩子的成長起點</h1><p>先選一所校園，慢慢認識我們。</p></div></div><div class="campus-tabs" role="tablist" aria-label="選擇校園">${window.menuCampuses.map((c, i) => `<button type="button" role="tab" id="tab-${c.key}" aria-selected="${i === 0}" aria-controls="school-detail" tabindex="${i === 0 ? 0 : -1}" data-campus="${c.key}">${c.name}</button>`).join('')}</div><section class="school-detail" id="school-detail" role="tabpanel" aria-labelledby="tab-yihua">${schoolDetail(window.menuCampuses[0])}</section><div class="discover-head">也想多了解常春藤</div>${navigation()}<span class="sr-only" id="campus-status" aria-live="polite"></span>`;
  const tabs = [...panel.querySelectorAll('[role="tab"]')];
  function selectCampus(index, focus = false) {
    const campus = window.menuCampuses[index];
    tabs.forEach((tab, i) => {
      tab.setAttribute('aria-selected', String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
    });
    const detail = document.querySelector('#school-detail');
    detail.innerHTML = schoolDetail(campus);
    detail.setAttribute('aria-labelledby', 'tab-' + campus.key);
    document.querySelector('#campus-status').textContent = `已顯示${campus.name}的照片與聯絡資訊`;
    if (focus) tabs[index].focus();
  }
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => selectCampus(i));
    tab.addEventListener('keydown', event => {
      const indexes = { ArrowRight: (i + 1) % tabs.length, ArrowLeft: (i + tabs.length - 1) % tabs.length, Home: 0, End: tabs.length - 1 };
      if (!(event.key in indexes)) return;
      event.preventDefault();
      selectCampus(indexes[event.key], true);
    });
  });
}

function setOpen(open, returnFocus = false) {
  panel.hidden = !open;
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', open ? '關閉選單' : '開啟選單');
  if (returnFocus) toggle.focus();
  if (open) panel.querySelector('a,button')?.focus();
}
toggle.addEventListener('click', () => setOpen(panel.hidden));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !panel.hidden) setOpen(false, true);
});
document.addEventListener('pointerdown', event => {
  if (!event.target.closest('.menu-anchor') && !panel.hidden) setOpen(false, panel.contains(document.activeElement));
});
panel.addEventListener('click', event => {
  if (event.target.closest('a')) setOpen(false, true);
});
