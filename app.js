'use strict';
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
// 預覽用：index.html?hero=quiet#/home 看首屏完全沒有字的樣子（只留頁首與影片控制鈕）。
if (new URLSearchParams(location.search).get('hero') === 'quiet') document.documentElement.classList.add('hero-quiet');
// 園方廣告片剪出的校園片段（design/hero-video/build.sh）。
const HERO_VIDEO_SRC = 'assets/hero-campus.mp4';
// 常春藤機構粉絲專頁：明華／崇德／國際／仁武四校的 Facebook 暫時指向這裡，LINE 官方帳號待園方提供（不用義華帳號冒充）。
const ORG_FACEBOOK = 'https://www.facebook.com/ivykid';
const campuses = {
 yihua:{name:'義華校',district:'三民區',address:'高雄市三民區義華路68號',phone:'07-392-8366',image:'yihua-exterior',panoramaPos:'center 12%',photoPos:'85% center',heroPhotoPos:'85% 8%',intro:'在義華路上，走進孩子的日常。',description:'從戶外廣場、綠色園藝到共創教室，認識孩子每天活動、探索與學習的空間。義華校重視愛與關懷、閱讀素養與生活自理，陪伴孩子練習與世界相處。',line:'https://lin.ee/gwl8fnA',facebook:'https://www.facebook.com/ivy.kids.fb/',fbNote:'義華校粉絲專頁'},
 minghua:{name:'明華校',district:'左營區',address:'高雄市左營區明華一路176號',phone:'07-556-6796',image:'minghua',intro:'在明華一路，認識我們的校園。',description:'明華校位於高雄市左營區明華一路。先從校園外觀與所在位置認識學校，再安排一次參觀，親自了解孩子的學習環境與接送動線。',line:null,facebook:ORG_FACEBOOK,fbNote:'常春藤機構粉絲專頁（明華校粉專待補）'},
 chongde:{name:'崇德校',district:'左營區',address:'高雄市左營區崇德路87號',phone:'07-341-6286',image:'chongde',intro:'從崇德路，開始一段校園探索。',description:'崇德校位於高雄市左營區崇德路。歡迎預約到園，看看校園空間，也與園所聊聊孩子的需要、生活安排與入學準備。',line:null,facebook:ORG_FACEBOOK,fbNote:'常春藤機構粉絲專頁（崇德校粉專待補）'},
 international:{name:'國際校',district:'鳥松區',address:'高雄市鳥松區球場路59號',phone:'07-370-8001',image:'international',photoPos:'48% center',intro:'走進鳥松，認識國際校。',description:'國際校位於高雄市鳥松區球場路。透過實際走訪了解校園環境與接送路線，並向園所確認適合孩子的課程與入學安排。',line:null,facebook:ORG_FACEBOOK,fbNote:'常春藤機構粉絲專頁（國際校粉專待補）'},
 renwu:{name:'仁武校',district:'仁武區',address:'高雄市仁武區京吉一路102號',phone:'07-375-7081',image:'renwu',intro:'在仁武，遇見下一段成長。',description:'仁武校位於高雄市仁武區京吉一路。歡迎帶著對孩子成長的期待來認識校園，參觀時也可以與園所討論課程、生活照顧與接送安排。',line:null,facebook:ORG_FACEBOOK,fbNote:'常春藤機構粉絲專頁（仁武校粉專待補）'}
};
// 五校位置示意圖：北高雄行政區邊界（OSM／Nominatim，經 design/campus-directions/gen-map.py 簡化，僅留視窗內的區）與五校所在道路節點，非門牌精確位置。
const CAMPUS_MAP={"districts":[{"name":"三民區","core":true,"cx":265.4,"cy":345,"d":"M129.6 387.6 L139.5 407.1 L144.5 433.3 L191.8 413.5 L243.5 414.4 L261.2 430.1 L265.4 425.4 L256.4 407.5 L352 425.5 L353.7 412.8 L371.4 405.7 L356.3 395.3 L365.3 376.3 L359.1 373.8 L354.8 378.1 L329.7 358.7 L303 325.1 L323 325.9 L311.8 303.7 L333.2 283.6 L333.7 278.5 L327.3 273.2 L293.4 280.7 L288.8 272.1 L302.4 264.3 L298.6 262 L287.7 268.2 L292.7 264 L285.6 248.9 L265.9 270 L256.3 288.7 L246.2 290.6 L233.2 316.5 L238 335.7 L234.4 344 L191.4 358.1 L179.3 355.1 L168.2 365.2 L149.3 362.3 L133.5 376.8 L129.6 387.6Z"},{"name":"仁武區","core":true,"cx":398.2,"cy":148,"d":"M246.6 187.7 L252.3 198.1 L269.3 210.1 L277.7 229.2 L281.3 228.9 L272 242.3 L277.6 247.8 L287.1 247 L292.7 264 L287.7 268.2 L298.6 262 L302.4 264.3 L288.8 272.1 L293.4 280.7 L327.3 273.2 L362.9 287.1 L386.3 274.9 L395.7 289.7 L415.6 288.3 L425.6 279.6 L431.7 263.8 L441.4 261 L458.3 233.7 L474.7 224.3 L475.2 213.1 L491 206.4 L510.7 185.2 L521 192.2 L533.8 176.6 L536.2 167.8 L524.1 160 L547.4 124.5 L545.1 114.8 L558.6 77.6 L547.2 73.2 L552.7 44.7 L546.7 35.9 L531.8 39 L521.3 35.2 L522.3 21.8 L516.2 19 L514.9 12.2 L505.8 12 L497.1 20 L495.8 27.5 L479.6 33.9 L472.6 42.2 L468.6 51.3 L470.1 64.1 L464 63.2 L451.3 71.6 L454.2 89.3 L449.1 113.9 L440.4 117.3 L440 124.1 L422.1 137.3 L398.4 111.6 L375.4 103.8 L368.6 112.6 L366.7 108.9 L358.2 111.4 L356 106.4 L338.7 110.9 L331.9 105.2 L328.5 91.1 L317 86.5 L307.3 89.8 L310.9 95.9 L300.8 102.9 L295.7 98.5 L279.9 104.6 L298.3 129 L296.3 136.7 L284.9 138 L298.9 154.4 L277.3 150.9 L269.7 165.1 L246.6 187.7Z"},{"name":"前金區","core":false,"cx":179.5,"cy":455.1,"d":"M144.5 433.3 L159.5 475.4 L176.4 474 L180.6 485.6 L201.6 478.2 L197.6 466.2 L199.2 450.3 L187.5 454.5 L185.2 448.1 L194 445.1 L183.9 416.9 L144.5 433.3Z"},{"name":"大寮區","core":false,"cx":537.8,"cy":593.3,"d":"M435.6 579.3 L442 589.6 L438.1 598.8 L453.5 610.3 L452.6 620.2 L468.2 624.7 L476 621.5 L487.7 637.7 L496.2 641.3 L497.4 671.9 L508.2 674.6 L516.5 688.5 L524.8 685.5 L518.6 684.6 L516.4 680.2 L527.4 684.5 L524.2 691 L529.9 694.4 L531.5 706.4 L525.2 709.9 L530.5 720.8 L526.6 723.5 L532.3 723.8 L542.9 749.5 L520.6 794.1 L525.4 797.5 L545.5 793.6 L558.6 801.4 L558.5 807.7 L581.1 811.6 L644.1 806 L657.5 766.4 L676.3 755.2 L695.6 706.9 L713.1 608.2 L708.8 559 L697.9 541.8 L679.4 526.3 L665.9 486.8 L665.8 462.3 L674 435.1 L674.4 357.1 L639.2 366.3 L603.6 390.2 L571.3 386.4 L551.9 390 L532.1 384.2 L492 394.2 L481.1 404.4 L469.7 407.2 L469.5 415.5 L483.9 440.8 L490 445 L497.8 441.6 L503.1 454.1 L470.3 468.8 L475.8 490 L466.9 524.3 L458.9 530.7 L451.7 529.8 L445.5 544.2 L446.6 563.4 L435.6 579.3Z"},{"name":"大樹區","core":false,"cx":592.9,"cy":141.2,"d":"M511 228.2 L538.8 245.8 L532.5 249 L532.5 257.4 L536.8 259.4 L540.8 280.6 L556.3 300.9 L557.2 326.8 L545.7 355.9 L553.1 373.2 L547.3 381.4 L548.7 387.8 L603.6 390.2 L639.2 366.3 L674.4 357.1 L674.7 316.4 L688.3 274.6 L686.9 255.1 L697.4 231.7 L714.5 217.4 L719 207 L743.9 101.2 L745 55.1 L736.8 -41.3 L738.8 -102.3 L657.3 -111.3 L647.9 -125.3 L634.1 -114.2 L614.1 -113 L604.1 -89.1 L608 -73.8 L587.3 -45.9 L588.6 -29.1 L584.1 -14.4 L588.5 -8.7 L584.5 3.4 L564.9 24.6 L551.4 26.9 L547.1 23.3 L537.3 37.1 L550.1 39.5 L552.7 44.9 L547.2 73.2 L558.6 77.6 L545.1 114.8 L546.7 126.6 L524.1 160 L532.9 162.7 L536.3 169.7 L520.2 192.4 L522.5 205.5 L511.5 220.5 L511 228.2Z"},{"name":"大社區","core":false,"cx":444.4,"cy":12.7,"d":"M314.6 80.7 L328.8 91.4 L331.9 105.2 L338.7 110.9 L356 106.4 L358.2 111.4 L366.7 108.9 L368.6 112.6 L375.4 103.8 L406.6 116.9 L422.1 137.3 L440 124.1 L440.4 117.3 L449.1 113.9 L454.2 89.3 L451.3 71.6 L464 63.2 L470.1 64.1 L468.6 51.3 L472.6 42.2 L479.6 33.9 L495.8 27.5 L497.1 20 L505.8 12 L515.2 12.5 L524.2 28.1 L521.2 35.1 L531.8 39 L547.1 23.3 L551.4 26.9 L564.9 24.6 L580.9 8.1 L588.5 -8.7 L584.1 -14.4 L589 -49.6 L581.8 -53.7 L579.8 -62.3 L573.5 -61.4 L573.9 -69.7 L564.3 -82.1 L551.5 -79.6 L535.4 -58.9 L532.3 -64.1 L523.5 -64.8 L515.4 -75.5 L506.3 -65.4 L489.6 -69.7 L488.5 -59 L477.4 -52.2 L477.5 -45.3 L470.9 -46.6 L470 -42 L456.7 -38.6 L454.6 -23.6 L450.2 -30.8 L441.6 -32.5 L433.7 -18.3 L429.4 -24.8 L411.2 -23.5 L386.1 -30 L364.8 -25.3 L348.9 -41 L349.9 -30.3 L341.3 -34 L337.4 -31.1 L339.7 -18.1 L333.9 -10.7 L321.5 -15.4 L320.3 -1.6 L338.1 4.3 L325.6 19.1 L326.7 23.9 L336 25 L330.4 43.4 L337.4 54.9 L319.5 66.8 L314.6 80.7Z"},{"name":"左營區","core":true,"cx":133.7,"cy":226.7,"d":"M22.9 183.6 L30.2 191 L30.4 191 L22.9 183.6Z M39.2 205.3 L42.1 207.2 L48 209.6 L64.2 214 L65.8 220.9 L65.9 270.8 L54.5 288.4 L44.2 292 L45.3 295.7 L53.6 293.6 L67.3 280.6 L115 271 L129.9 281.5 L146.8 284.7 L153.7 295.8 L169.8 276.6 L190 301 L205.8 303.1 L205.7 339.5 L225.2 337.8 L225 345.5 L237.2 340.9 L233.2 316.5 L246.2 290.6 L256.3 288.7 L265.9 270 L283.5 249.6 L288 249.4 L272.2 242.7 L281.3 228.9 L277.7 229.2 L269.3 210.1 L252.3 198.1 L253.4 194.1 L236.8 174.9 L222.5 190.5 L203.3 176.1 L203.1 169.2 L186.2 169.4 L175.8 151.8 L193.6 142.5 L182.9 135.7 L167.7 152.5 L105.3 153.5 L105.1 168.9 L91 168.7 L93.4 182.5 L105.2 179.1 L105.1 188.4 L95.5 188.3 L95.5 185.7 L94 185.7 L94.4 184 L93.8 183.7 L91.6 186.8 L93.6 191.8 L101.2 192.3 L102.4 207.8 L92.6 219.1 L105.2 233.6 L97.9 239 L94.2 234.3 L97.2 239.6 L93 235.1 L96.3 240.3 L89.5 248.3 L79.9 245.6 L73.9 207.9 L58.1 206.6 L55.2 201.8 L56.9 206.7 L49.5 209.7 L39.2 205.3Z"},{"name":"新興區","core":false,"cx":216.1,"cy":444,"d":"M183.9 416.9 L194 445.1 L185.2 448.1 L187.5 454.5 L199.2 450.3 L197.6 466.2 L201.6 478.2 L236.6 465.6 L232.5 453.7 L244.2 449.5 L240.8 437.5 L257.5 438.9 L253.5 423.6 L243.5 414.4 L183.9 416.9Z"},{"name":"楠梓區","core":false,"cx":209,"cy":83.8,"d":"M34.5 178.5 L54.9 191.7 L66.7 182.1 L73 185 L63.4 176.2 L66 152.8 L74.6 152.8 L75.9 145.9 L78.9 147.5 L77.2 143.4 L68.7 144.7 L71.2 139.3 L83 136.4 L105.5 146.3 L105.3 153.5 L167.7 152.5 L182.9 135.7 L193.6 142.5 L175.8 151.8 L186.2 169.4 L203.1 169.2 L203.3 176.1 L222.5 190.5 L236.2 174.5 L246.6 187.7 L269.7 165.1 L277.3 150.9 L298.9 154.4 L284.9 138 L296.3 136.7 L298.3 129 L279.9 104.6 L295.7 98.5 L300.8 102.9 L310.9 95.9 L307.3 89.8 L315.6 86.5 L326.6 91.5 L314.7 81 L315.2 75 L319.5 66.8 L337.2 56 L330.4 43.4 L336 25 L326.7 23.9 L325.6 19.1 L338.1 4.3 L320.3 -1.6 L321.5 -15.4 L316.8 -17 L315.4 -28.3 L306.7 -29.8 L303.9 -38.5 L290.7 -37.6 L284.1 -42.8 L283.4 -17.2 L288.2 -12 L275.6 2.8 L285 12.8 L275.5 20.6 L285 34.6 L273.1 42.6 L255 36.9 L249.7 30.6 L238.3 36.4 L224.2 33.1 L234.5 52.1 L230 58.1 L207.3 55.9 L197.4 61 L191.7 49.4 L181.9 63.6 L177.4 59.8 L179.3 51.9 L163.1 29.7 L143.9 28.3 L141.5 35.5 L115 27.2 L110.3 42.9 L105.8 43.7 L106.8 51 L91.6 55.7 L85.9 51.2 L74.3 57.8 L39 102.3 L56.7 161.1 L34.5 178.5Z"},{"name":"苓雅區","core":false,"cx":266.4,"cy":471.3,"d":"M154.2 509.9 L179.6 522 L211.9 507.9 L209.8 501.2 L256.7 484.5 L258.5 495.7 L283.2 497.3 L282.4 508.8 L288.2 509.6 L288.8 491.4 L293.1 491.3 L292.5 487.2 L315.7 484 L316.7 492.5 L333.6 487.1 L337.6 481.8 L329 475.9 L335.5 461.5 L350.4 459.4 L350.8 447.1 L333 441.7 L341.5 440.3 L348.1 428.2 L353.9 427.9 L254.7 407.7 L265.4 425.4 L261.2 430.1 L253.5 423.6 L257.5 438.9 L240.8 437.5 L244.2 449.5 L232.5 453.7 L236.6 465.6 L180.6 485.6 L176.4 474 L159.5 475.4 L159.6 497.3 L154.2 509.9Z"},{"name":"鳥松區","core":true,"cx":448.4,"cy":318.3,"d":"M302.9 324.8 L326.5 351.1 L324.5 353.7 L354.8 378.1 L364.2 372 L375.2 376.2 L380.2 373.5 L399.2 394 L402.7 372.9 L414.1 376.2 L422.5 385.8 L423.6 380.7 L437.6 376.3 L435.9 370.6 L444.5 368.6 L447.9 376.2 L457.1 372.8 L468.6 410.1 L492 394.2 L505.9 393.2 L512.4 388.1 L536.9 383.8 L548.9 388.4 L547.3 381.4 L553.1 374.5 L545.7 355.9 L557.2 326.8 L556.3 300.9 L540.8 280.6 L536.8 259.4 L532.5 257.4 L532.5 249 L538.8 245.8 L511 228.2 L523.1 202.4 L520.2 192.4 L511.4 185.1 L491 206.4 L474.1 214.2 L474.7 224.3 L458.3 233.7 L441.4 261 L431.7 263.8 L425.6 279.6 L415.6 288.3 L395.7 289.7 L386.3 274.9 L362.9 287.1 L338.7 275.4 L311.8 303.7 L323 325.9 L302.9 324.8Z"},{"name":"鳳山區","core":false,"cx":372.5,"cy":498.5,"d":"M266.6 588.5 L276.3 596.9 L281.4 607.8 L275.2 607.7 L279.5 612.2 L298.6 605.8 L314.7 607.3 L314.7 594.7 L318.8 590.8 L326.9 599.2 L327.6 606.4 L333.9 608.3 L332.7 613.9 L341.2 617.6 L371.9 608.7 L412.8 612.6 L421.2 606.2 L439.9 604.4 L442.2 601 L438.1 596.9 L442 589.6 L435.6 578.9 L446.6 563.4 L445.5 544.2 L451.7 529.8 L458.9 530.7 L466.9 524.3 L475.8 490 L470.3 468.8 L503.1 454.1 L497.8 441.6 L490 445 L479.6 433.6 L459.2 388.3 L462.1 384.9 L457.1 372.8 L447.9 376.2 L444.5 368.6 L435.9 370.6 L437.6 376.3 L423.6 380.7 L422.5 385.8 L414.1 376.2 L402.7 372.9 L399.2 394 L380.2 373.5 L360.9 373.8 L365.3 376.3 L356.3 395.3 L371.4 405.7 L353.7 412.8 L353.9 428.1 L348.1 428.2 L341.5 440.3 L333 441.7 L350.8 447.1 L350.4 459.4 L335.5 461.5 L329 475.9 L337.6 481.8 L325.5 491.5 L316.7 492.5 L315.7 484 L292.5 487.2 L293.1 491.3 L288.8 491.4 L289.3 507.4 L309.4 506.2 L309.1 516 L326.4 515.2 L332.9 533.3 L274.8 568.1 L273 585 L266.6 588.5Z"},{"name":"鹽埕區","core":false,"cx":132.5,"cy":463.8,"d":"M112.9 468.3 L119.4 477.3 L159.6 497.3 L158.6 465.9 L141.8 421.9 L122.2 447.8 L112.9 468.3Z"},{"name":"鼓山區","core":false,"cx":112.5,"cy":374.8,"d":"M18.1 356.4 L23.8 381.9 L39 415.9 L50.2 424.9 L53.1 437.2 L58.4 439.1 L63.3 449.9 L59.8 465.2 L34.6 477.3 L95.6 499.2 L115.1 512.2 L128.2 499.7 L154.2 509.9 L159.6 497.3 L119.4 477.3 L112.9 468.3 L122.2 447.8 L141.8 421.9 L129.6 387.6 L130.9 380.7 L149.3 362.3 L168.2 365.2 L179.3 355.1 L191.2 358.2 L202.4 351.7 L215.8 351.2 L225 345.5 L225.2 337.8 L205.7 339.5 L205.8 303.1 L190 301 L171.7 277.4 L153.7 295.8 L144.2 283.4 L129.5 281.3 L118.1 271.6 L101.8 271.3 L66.9 280.7 L51.2 295.1 L41.8 291.7 L31.1 303.8 L24.5 303.4 L20.8 309.5 L23.4 323 L18.1 356.4Z"}],"pins":{"yihua":{"x":330.7,"y":389.5,"label":"義華校"},"minghua":{"x":227.9,"y":314.7,"label":"明華校"},"chongde":{"x":206.1,"y":264.1,"label":"崇德校"},"international":{"x":330.7,"y":337,"label":"國際校"},"renwu":{"x":341.4,"y":240.6,"label":"仁武校"}}};
const main = document.querySelector('#main');
const nav = document.querySelector('#navigation');
const menu = document.querySelector('#menu-toggle');
const header = document.querySelector('.header');
const updateHeader = () => header.classList.toggle('is-scrolled', window.scrollY > 8);
window.addEventListener('scroll', updateHeader, {passive:true});
updateHeader();
const esc = value => String(value).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const photoSrc = name=>'assets/'+name+'.webp';
const campusArtSrc = key=>photoSrc('campus-line-art-'+key);
const campusArtwork = key=>`<div class="campus-artwork" aria-hidden="true"><img class="campus-art-building" src="${campusArtSrc(key)}" alt="" loading="lazy" decoding="async"></div>`;
const img = (name,alt,cls='',eager=false,priority=false)=>`<img class="${cls}" src="${photoSrc(name)}" alt="${esc(alt)}" loading="${eager?'eager':'lazy'}"${priority?' fetchpriority="high"':''} decoding="async">`;
const mapURL = c=>'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(c.address);
// 免金鑰的單一地點嵌入；五校同框需要園方另建 Google 我的地圖或申請 Maps API 金鑰（見 design/campus-directions/README.md）。
const embedURL = c=>'https://www.google.com/maps?q='+encodeURIComponent(c.address)+'&z=16&hl=zh-TW&output=embed';
const dirURL = c=>'https://www.google.com/maps/dir/?api=1&destination='+encodeURIComponent(c.address);
const bookingLink = key=>'#/visit'+(key?'/'+key:'');
const icon = name=>`<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`;
const arrow = icon('arrow-up-right');
const external = 'target="_blank" rel="noopener noreferrer"';
// Google 地圖 embed 載入時會把焦點移進地圖，畫面外載入會把整頁捲走；iframe 進到視口附近才補上 src。
const mapFrameObserver = new IntersectionObserver(entries=>{entries.forEach(e=>{if(e.isIntersecting){const f=e.target;f.src=f.dataset.src;mapFrameObserver.unobserve(f);}});},{rootMargin:'160px 0px'});
const armMapFrames = scope=>scope.querySelectorAll('iframe[data-src]:not([src])').forEach(f=>mapFrameObserver.observe(f));
// LINE／Facebook 文字連結：品牌原色圖示＋標籤＋外連 ↗。沒有 LINE 帳號的校區顯示「待園方提供」，不用其他校區帳號冒充。
const campusLinks = c=>{
 const line=c.line?`<a class="campus-link line" href="${c.line}" ${external}><span class="campus-link-badge">${icon('line')}</span><span class="campus-link-text"><span class="campus-link-title">加 LINE 好友${arrow}</span><small>${c.name}官方帳號</small></span></a>`
  :`<span class="campus-link line is-pending"><span class="campus-link-badge">${icon('line')}</span><span class="campus-link-text"><span class="campus-link-title">LINE 官方帳號</span><small>${c.name}帳號待園方提供</small></span></span>`;
 const fb=`<a class="campus-link facebook" href="${c.facebook}" ${external}><span class="campus-link-badge">${icon('facebook')}</span><span class="campus-link-text"><span class="campus-link-title">Facebook 粉絲專頁${arrow}</span><small>${esc(c.fbNote)}</small></span></a>`;
 return `<div class="campus-links">${line}${fb}</div>`;
};
// 五校位置示意圖：核心四區淺綠、其餘紙白；每個校區同時畫「小圓點＋校名」與「大圖釘＋校名牌」，用 is-selected 切換顯示。
const campusMap = (selected, vb='80 150 480 270')=>{
 const d=CAMPUS_MAP.districts;
 const areas=d.filter(x=>!x.core).map(x=>`<path d="${x.d}"/>`).join('')+d.filter(x=>x.core).map(x=>`<path class="is-core" d="${x.d}"/>`).join('');
 const labels=d.filter(x=>x.core).map(x=>`<text x="${x.cx}" y="${x.cy}">${x.name}</text>`).join('');
 const pins=Object.entries(CAMPUS_MAP.pins).map(([key,p])=>`<g class="campus-map-pin${key===selected?' is-selected':''}" data-campus="${key}"><g class="pin-dot"><circle cx="${p.x}" cy="${p.y}" r="5.5"/><text x="${p.x+10}" y="${p.y+4.5}">${campuses[key].name}</text></g><g class="pin-focus"><use href="#i-map-pin" x="${p.x-15}" y="${p.y-28}" width="30" height="30"/><rect x="${p.x+14}" y="${p.y-24}" width="57" height="27" rx="2"/><text x="${p.x+23}" y="${p.y-6}">${campuses[key].name}</text></g></g>`).join('');
 return `<svg class="campus-map-svg" viewBox="${vb}" preserveAspectRatio="xMidYMid slice" role="img" aria-label="五校位置示意圖，目前標示${campuses[selected].name}"><g class="campus-map-areas">${areas}</g><g class="campus-map-labels">${labels}</g>${pins}</svg>`;
};
const campusStageInfo = c=>`<h3 class="campus-stage-name">${c.name}<span>高雄 · ${c.district}</span></h3><div class="campus-stage-contact"><dl class="campus-stage-facts"><div><dt>${icon('map-pin')}所在地</dt><dd>${c.address}</dd></div><div><dt>${icon('phone')}參觀專線</dt><dd><a href="tel:${c.phone}">${c.phone}</a></dd></div></dl>${campusLinks(c)}</div>`;
const campusStageActions = (c,key)=>`<a class="button primary" href="${bookingLink(key)}">預約參觀${c.name}${icon('arrow-right')}</a><a class="text-link" href="#/${key}">認識${c.name}${icon('arrow-right')}</a>`;
// 首頁 B 全幅橫景：照片上置、下方三欄資訊；每 6 秒切換，操作與減少動態時暫停。
const campusShowcase = (selected='yihua')=>{
 const keys=Object.keys(campuses);
 const segs=keys.map(key=>{const on=key===selected;return `<button type="button" role="tab" class="campus-seg" id="campus-tab-${key}" aria-selected="${on}" tabindex="${on?0:-1}" aria-controls="campus-stage" data-campus="${key}">${campuses[key].name}</button>`;}).join('');
 const c=campuses[selected];
 const prev=`<button type="button" class="campus-stage-btn" data-step="-1" aria-label="上一校">${icon('arrow-left')}</button>`,next=`<button type="button" class="campus-stage-btn" data-step="1" aria-label="下一校">${icon('arrow-right')}</button>`;
 return `<div class="campus-picker"><span class="campus-picker-nav">${prev}</span><div class="campus-track" role="tablist" aria-label="選擇校區">${segs}</div><span class="campus-picker-nav">${next}</span></div><div class="campus-stage" id="campus-stage" role="tabpanel" aria-labelledby="campus-tab-${selected}"><figure class="campus-stage-media" style="--photo-pos:${c.photoPos||'center'};--panorama-pos:${c.panoramaPos||'center 55%'}">${img(c.image,c.name+'校園外觀','campus-stage-photo')}</figure><div class="campus-stage-nav">${prev}${next}</div><div class="campus-stage-details"><div class="campus-stage-info">${campusStageInfo(c)}</div><div class="campus-stage-side"><div class="campus-stage-actions">${campusStageActions(c,selected)}</div><div class="campus-map campus-map-stage">${campusMap(selected,'100 200 460 215')}<a class="map-embed-link" href="${dirURL(c)}" ${external}>${icon('navigation-arrow')}規劃路線 ${arrow}</a></div></div></div></div><p class="sr-only" aria-live="off" id="campus-live"></p>`;
};
const campusMapFrame = (c,cls='')=>`<div class="map-embed ${cls}"><iframe title="${c.name} Google 地圖" data-src="${embedURL(c)}" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe><a class="map-embed-link" href="${dirURL(c)}" ${external}>${icon('navigation-arrow')}規劃路線 ${arrow}</a></div>`;
let currentPage='';
let lastPhotoTrigger=null;
let routeVersion=0;
let disposeMedia=()=>{};
function banner(key='') {return `<section class="visit-banner"><div class="container"><div><span class="eyebrow">預約參觀</span><h2 class="section-title">親自走一趟，感受${key?campuses[key].name:'常春藤'}的日常。</h2><p>帶著孩子，也帶著你想了解的事。我們期待與你相遇。</p></div><a class="button yellow" href="${bookingLink(key)}">預約校園參觀</a></div></section>`;}
function faq(key='') {return `<div class="faq-list"><details><summary>第一次參觀，要怎麼預約？</summary><p>先選擇想參觀的校區，再留下家長稱呼、電話與方便聯絡的時段。這份 prototype 僅示範流程，不會送出資料；實際參觀請直接致電園所。</p></details><details><summary>參觀時可以了解哪些事情？</summary><p>可以詢問校園環境、課程與生活安排、接送方式，以及孩子入學前需要準備的事。各校參觀範圍與接待時間請先向園所確認。</p></details><details><summary>可以查詢招生年齡、名額與費用嗎？</summary><p>招生年齡、名額與費用依校區與學年度而異。請向${key?campuses[key].name:'欲參觀的園所'}確認；這份提案不提供即時招生名額或費用報價。</p></details><details><summary>五所校區的環境與課程都一樣嗎？</summary><p>各校空間與課程安排可能不同。你可以先比較所在地與接送距離，再於參觀時了解該校的實際內容。</p></details></div>`;}
const dayMoments = [
 {key:'hello',icon:'sun-horizon',label:'早安入園',period:'一天的開始',title:'早安，今天的我\n準備好了。',story:'和家人說聲再見，走進熟悉的校園。從整理小書包開始，一點一點，找到自己的步調。',image:'campus',caption:'義華校校園照片 · 入園情境示意',question:'孩子第一次上學，如何陪伴適應？',answer:'參觀時可以與園所聊聊：初次入園的陪伴方式、家長如何與老師聯繫，以及可以事先做哪些準備。',word:'一聲早安，是一天的小小起點。'},
 {key:'discover',icon:'magnifying-glass',label:'好奇探索',period:'上午的發現',title:'我的「為什麼」，\n今天又多了一個。',story:'摸一摸、看一看，再和同伴試一次。那些讓眼睛發亮的小發現，是認識世界的開始。',image:'learning',caption:'義華校學習情境照片',question:'孩子平常會接觸哪些學習活動？',answer:'可以詢問該校如何安排探索活動、使用哪些教具與素材，以及如何依照年齡和孩子的興趣調整內容。',word:'把好奇留住，把答案慢慢找出來。'},
 {key:'lunch',icon:'bowl-food',label:'一起用餐',period:'午間的小事',title:'「我自己來！」\n是今天的小進步。',story:'洗洗手、準備用餐，也練習照顧自己。每天重複的小事情，都可以成為成長的練習。',image:'classroom',caption:'義華校教室空間參考 · 用餐照片待補',question:'餐點、飲食需求與自理練習怎麼安排？',answer:'參觀時可詢問餐點安排、食物過敏或特殊飲食需求的溝通方式，以及老師如何協助孩子練習用餐。',word:'成長，也藏在生活的小事情裡。'},
 {key:'rest',icon:'moon-stars',label:'安靜片刻',period:'慢下來的午後',title:'小小的世界，\n也需要休息一下。',story:'把熱鬧的節奏放慢，留一點安靜給自己。休息之後，再帶著精神迎接下午。',image:'classroom',caption:'義華校教室空間參考 · 午休照片待補',question:'孩子睡不著，或有不同的休息需求呢？',answer:'可以向園所了解休息空間與安排，以及孩子尚未習慣午休時，老師會如何陪伴和與家長溝通。',word:'慢一點，也是在好好長大。'},
 {key:'outside',icon:'tree',label:'午後玩耍',period:'午後的冒險',title:'和朋友一起，\n把今天玩得好大。',story:'看看植物、動動身體，發現身邊的新鮮事。和同伴一起玩的時候，也在練習分享與表達。',image:'garden',caption:'義華校綠色園藝照片 · 戶外情境參考',question:'戶外活動與天氣變化如何安排？',answer:'參觀時可詢問戶外活動的空間、陪伴方式，以及下雨或天氣炎熱時，園所如何調整當天的安排。',word:'一小片自然，也能裝下很多發現。'},
 {key:'home',icon:'house-line',label:'帶故事回家',period:'把今天帶回家',title:'今天的好多事，\n想第一個告訴你。',story:'帶上書包，也帶上今天的新發現。和家人分享一件開心的小事，讓校園裡的故事繼續走進生活。',image:'hero',caption:'義華校生活照片 · 離園情境示意',question:'接送與家長聯繫，有哪些需要先知道？',answer:'可以詢問園所的接送流程、家長與老師的聯繫方式，以及如何了解孩子在校的生活情況。',word:'把新發現，帶回最熟悉的懷抱。'}
];
function dayExperience(){return `<section class="section day-experience" id="life" aria-labelledby="day-heading"><div class="container"><header class="day-heading"><span class="eyebrow">孩子的一天</span><h2 class="section-title" id="day-heading">跟著孩子，過一天。</h2></header><div class="day-tabs" role="tablist" aria-label="孩子的一天，選擇生活片刻">${dayMoments.map((m,i)=>`<button type="button" class="day-tab" role="tab" id="day-tab-${m.key}" aria-controls="day-panel" aria-selected="${i===0}" tabindex="${i===0?0:-1}" data-moment="${i}">${m.label}</button>`).join('')}</div><p class="sr-only" id="day-status" aria-live="polite"></p><div id="day-panel" class="day-panel" role="tabpanel" aria-labelledby="day-tab-hello" tabindex="0"></div><p class="day-note">日常情境提案，以義華校影像呈現；各校、各班實際作息請向園所確認。</p></div></section>`;}
function setupDayExperience(){
 const panel=document.querySelector('#day-panel');if(!panel)return;
 const tablist=document.querySelector('.day-tabs'),tabs=[...tablist.querySelectorAll('.day-tab')];let current=0,ready=false;
 function keepTabVisible(index){
  const tab=tabs[index].getBoundingClientRect(),list=tablist.getBoundingClientRect();
  if(tab.left<list.left+8)tablist.scrollBy({left:tab.left-list.left-8,behavior:'instant'});
  else if(tab.right>list.right-8)tablist.scrollBy({left:tab.right-list.right+8,behavior:'instant'});
 }
 function show(index,focusTab=false){
  current=index;const m=dayMoments[index],next=dayMoments[(index+1)%dayMoments.length];
  tabs.forEach((tab,i)=>{const active=i===index;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;});
  panel.setAttribute('aria-labelledby',`day-tab-${m.key}`);panel.dataset.moment=m.key;
  panel.innerHTML=`<figure class="day-scene">${img(m.image,m.caption,'day-photo',true)}<figcaption>${m.caption}</figcaption></figure><div class="day-story"><h3>${m.title.split('\n').join('<br>')}</h3><p class="day-narrative">${m.story}</p><details class="day-parent"><summary><span>${m.question}</span><span class="day-toggle" aria-hidden="true">＋</span></summary><p>${m.answer}</p></details><div class="day-links"><a class="text-link" href="#/home/campuses">想親自看看？認識五所校園</a><button type="button" data-day-next>${index===dayMoments.length-1?'回到':'下一段：'}${next.label}${icon('arrow-right')}</button></div></div>`;
  if(focusTab)tabs[index].focus({preventScroll:true});
  if(ready){keepTabVisible(index);document.querySelector('#day-status').textContent=`${m.label}：${m.title.replace('\n','')}`;}
 }
 tabs.forEach((tab,i)=>{tab.addEventListener('click',()=>show(i));tab.addEventListener('keydown',e=>{let next;if(e.key==='ArrowRight')next=(i+1)%tabs.length;if(e.key==='ArrowLeft')next=(i+tabs.length-1)%tabs.length;if(e.key==='Home')next=0;if(e.key==='End')next=tabs.length-1;if(next!==undefined){e.preventDefault();show(next,true);}});});
 panel.addEventListener('click',e=>{if(!e.target.closest('[data-day-next]'))return;show((current+1)%dayMoments.length);if(matchMedia('(max-width: 760px)').matches){panel.focus({preventScroll:true});panel.scrollIntoView({block:'start',behavior:'instant'});}else panel.querySelector('[data-day-next]').focus({preventScroll:true});});
 show(0);ready=true;
}

// A 版最新消息；文案、日期與活動均為原型示意，圖片經 photoSrc 支援單檔預覽。
const homepageNews = (() => {
 const articles = [
  {id:'garden',date:'2026-09-16',campus:'義華校',category:'校園日常',title:'小小園丁，把好奇心種進生活裡。',description:'從翻土、澆水到觀察新芽，陪孩子發現一片葉子裡的大世界。',image:'garden',alt:'既有校園果樹情境照片'},
  {id:'learning',date:'2026-09-12',campus:'義華校',category:'學習紀錄',title:'動手試試看，讓每個想法都有形狀。',description:'在創作與探索之間，看見孩子專注的眼神，也聽見他們自己的答案。',image:'learning',alt:'既有義華校學習活動情境照片'},
  {id:'renwu',date:'2026-09-10',campus:'仁武校',category:'分校消息',title:'走進仁武校，認識孩子的成長空間。',description:'透過校園圖像，先認識孩子每天生活與探索的地方。',image:'renwu',alt:'仁武校既有校園外觀示意圖'},
  {id:'minghua',date:'2026-09-08',campus:'明華校',category:'分校消息',title:'在明華，打開新學期的日常。',description:'新學期的相遇，從認識教室、老師與身邊的朋友開始。',image:'minghua',alt:'明華校既有校園照片'},
  {id:'chongde',date:'2026-09-05',campus:'崇德校',category:'分校消息',title:'一起認識崇德校的每個小角落。',description:'從一扇窗、一條走廊開始，慢慢熟悉每天探索的校園。',image:'chongde',alt:'崇德校既有校園照片'},
  {id:'international',date:'2026-09-03',campus:'國際校',category:'分校消息',title:'新朋友、新發現，校園生活開始了。',description:'帶著好奇走進校園，在一起生活的過程中，找到自己的步調。',image:'international',alt:'國際校既有校園照片'}
 ];
 const events = [
  {id:'visit',date:'2026-09-26',month:'SEP',campus:'全校',title:'秋季校園開放日',description:'和孩子一起，來看看未來的日常。'},
  {id:'family',date:'2026-10-03',month:'OCT',campus:'義華校',title:'親子共讀・故事的午後',description:'一本繪本，開啟一段親子對話。'},
  {id:'outdoor',date:'2026-10-17',month:'OCT',campus:'全校',title:'一起出發！親子探索日',description:'在戶外發現身邊的小驚喜。'}
 ];
 const arrow = '<span class="hn-arrow" aria-hidden="true">↗</span>';
 const picture = item => `<img src="${photoSrc(item.image)}" width="720" height="465" alt="${item.alt}" loading="lazy">`;
 const metadata = item => `<span class="hn-meta"><span>${item.campus}</span><time datetime="${item.date}">${item.date.replaceAll('-','.')}</time></span>`;
 const more = (type,label) => `<button type="button" class="hn-more" data-news-list="${type}" aria-haspopup="dialog">${label}${arrow}</button>`;
 const eventCard = item => `<button type="button" class="hn-event" data-news-event="${item.id}" aria-haspopup="dialog"><time class="hn-date" datetime="${item.date}" aria-label="${item.date}"><b>${item.date.slice(-2)}</b><span lang="en">${item.month}</span></time><span class="hn-event-copy"><small>${item.campus}</small><strong>${item.title}</strong></span>${arrow}</button>`;
 const newsCard = item => `<article class="hn-card">${picture(item)}<div class="hn-card-copy">${metadata(item)}<h3><button type="button" data-news-article="${item.id}" aria-haspopup="dialog">${item.title}</button></h3></div></article>`;
 let modal, content, lastTrigger, view = '';
 function section() {
  return `<section id="latest-news" class="home-news" aria-labelledby="latest-news-heading"><div class="container"><div class="hn-layout"><aside class="hn-events" aria-labelledby="upcoming-events-heading"><div class="hn-head"><span class="hn-kicker" lang="en">UPCOMING EVENTS</span><h2 id="upcoming-events-heading">近期活動</h2></div><div class="hn-event-stack">${events.map(eventCard).join('')}</div>${more('events','所有活動')}</aside><div class="hn-news"><div class="hn-head hn-news-head"><div><span class="hn-kicker" lang="en">LATEST NEWS</span><h2 id="latest-news-heading">最新消息</h2></div>${more('articles','所有最新消息')}</div><div class="hn-cards">${articles.slice(0,3).map(newsCard).join('')}</div></div></div><p class="hn-sample-note">設計示意｜消息與活動日期均為範例，圖像取自既有校園素材，非上述消息實拍。</p></div></section>`;
 }
 function show(markup, nextView) {
  const wasOpen = modal.open;
  content.innerHTML = markup;
  view = nextView;
  if (!wasOpen) modal.showModal();
  else content.querySelector('#home-news-dialog-title').focus({preventScroll:true});
  modal.scrollTop = 0;
 }
 function showList(type) {
  const isEvent = type === 'events';
  const rows = articles.map(item => `<button type="button" class="hn-list-row" data-news-article="${item.id}">${picture(item)}<span class="hn-list-copy">${metadata(item)}<strong>${item.title}</strong><span class="hn-category">${item.category}</span></span>${arrow}</button>`).join('');
  show(`<h2 id="home-news-dialog-title" tabindex="-1">${isEvent?'近期活動':'所有最新消息'}</h2><p class="hn-dialog-note">以下為設計示意內容。</p><div class="${isEvent?'hn-event-stack':'hn-list'}">${isEvent?events.map(eventCard).join(''):rows}</div>`,type);
 }
 function showDetail(item, type) {
  const isEvent = type === 'events';
  const back = view === type ? `<button type="button" class="hn-more hn-back" data-news-list="${type}">← 返回${isEvent?'活動':'消息'}清單</button>` : '';
  show(`${back}<span class="hn-kicker">${item.campus} · ${isEvent?'活動示意':item.category}</span><h2 id="home-news-dialog-title" tabindex="-1">${item.title}</h2>${isEvent?`<time class="hn-detail-date" datetime="${item.date}">${item.date.replaceAll('-','.')}</time>`:metadata(item)+picture(item)}<p class="hn-detail-copy">${item.description}</p><p class="hn-dialog-note">${isEvent?'這是示意活動，並非已公告的活動或開放報名。正式內容將由園方提供。':'此為閱讀互動示範，標題、日期與內容皆為範例；圖片使用既有校園素材。'}</p>`,isEvent?'event':'article');
 }
 function init() {
  if (modal) return;
  modal = document.createElement('dialog');
  modal.id = 'home-news-dialog';
  modal.className = 'hn-dialog';
  modal.setAttribute('aria-labelledby','home-news-dialog-title');
  modal.innerHTML = '<div class="hn-dialog-top"><span>常春藤 · 校園消息</span><button type="button" data-news-close aria-label="關閉消息" autofocus>關閉 ×</button></div><div class="hn-dialog-body"></div>';
  document.body.append(modal);
  content = modal.querySelector('.hn-dialog-body');
  modal.querySelector('[data-news-close]').addEventListener('click',close);
  modal.addEventListener('close',()=>{view='';if(lastTrigger?.isConnected)lastTrigger.focus({preventScroll:true});lastTrigger=null;});
  modal.addEventListener('click',e=>{if(e.target!==modal)return;const r=modal.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)close();});
  document.addEventListener('click',e=>{
   const trigger=e.target.closest('[data-news-article],[data-news-event],[data-news-list]');
   if(!trigger||!trigger.closest('.home-news,#home-news-dialog'))return;
   if(!modal.open)lastTrigger=trigger;
   if(trigger.dataset.newsList){showList(trigger.dataset.newsList);return;}
   const isEvent=Boolean(trigger.dataset.newsEvent);
   const item=(isEvent?events:articles).find(item=>item.id===(isEvent?trigger.dataset.newsEvent:trigger.dataset.newsArticle));
   if(item)showDetail(item,isEvent?'events':'articles');
  });
 }
 function close() {if(modal?.open)modal.close();}
 return {section,init,close};
})();

function home(){return `
<div class="home-reveal"><div class="home-reveal-track">
<section class="studio-hero" aria-labelledby="home-title"><div class="container studio-hero-grid">
 <div class="studio-hero-copy"><span class="eyebrow">常春藤幼兒園 · 高雄五校</span><h1 id="home-title">在常春藤<span class="punct">，</span><br>每一天都有<span class="hero-title-ending"><span class="growing-word">新發現<svg aria-hidden="true" viewBox="0 0 180 14"><path pathLength="1" d="M3 9Q48 2 92 7T177 6"/></svg></span><span class="punct">。</span></span></h1><p><span class="hero-copy-line">一起讀故事、做作品，也到戶外探索。</span><span class="hero-copy-line">在老師的陪伴下，動手試試，<span class="hero-copy-phrase">說出自己的想法。</span></span></p><div class="studio-actions"><a class="button ghost" href="#/home/life">看看孩子的一天</a></div></div>
 <figure class="studio-hero-image">${img('hero-campus-still','常春藤的孩子在戶外草地上奔跑、微笑的校園影片畫面','',true,true)}<video id="hero-video" muted loop playsinline preload="none" poster="assets/hero-campus-still.webp" aria-hidden="true" hidden></video></figure>
 </div><div class="container studio-media"><div id="video-controls" hidden><button type="button" id="video-play" aria-controls="hero-video"><span class="sr-only">播放影片</span></button></div></div></section></div>
<section class="section studio-about home-belief" id="about" aria-labelledby="about-title">
 <div class="belief-backdrop" aria-hidden="true"><div class="container belief-backdrop-inner"><div class="belief-watermark">關於<br>常春藤</div></div></div>
 <div class="container belief-content">
  <div class="belief-layout">
   <div class="belief-main"><p class="belief-since" lang="en">SINCE 1997</p><h2 id="about-title">把每個孩子，<br>放在心上。</h2>
    <p class="belief-text">自 1997 年在高雄創立，常春藤以專業保育與溫暖陪伴，為孩子打造安全、安心的成長環境。從遊戲、閱讀到動手探索，我們讓學習走進日常，鼓勵孩子發現問題、勇敢表達，也在相處中練習合作與關懷。我們重視每個孩子不同的步調，透過老師細心的引導，陪伴他們學會照顧自己、理解他人，慢慢累積自信與創造力，擁有充滿好奇、值得珍藏的童年。</p>
    <a class="text-link" href="#/home/campuses">認識五所校園${icon('arrow-up-right')}</a>
   </div>
   <figure class="belief-photo-pair">${img('about-curious','孩子在教室裡開心地指向自己的發現','belief-portrait')}${img('learning','孩子們一起趴在地上觀察與探索','belief-moment')}<figcaption>把日常，變成值得記住的童年。</figcaption></figure>
  </div>
 </div>
</section></div>
${dayExperience()}
<section class="section campuses campus-panorama" id="campuses" aria-roledescription="輪播" aria-labelledby="campuses-heading">${campusArtwork('yihua')}<div class="container"><div class="section-heading is-centered"><div><span class="eyebrow">Campuses</span><h2 class="section-title" id="campuses-heading">分校資訊</h2></div></div>${campusShowcase()}</div></section>
${homepageNews.section()}
`;}
// This is a flat-photo tour. Real 360 media can be supplied separately later.
const tourScenes = [
 {key:'courtyard',name:'戶外廣場',image:'campus',intro:'先從廣場開始，看看孩子每天活動的地方。',spots:[
  {name:'戶外活動空間',x:68,y:72,text:'從照片可以看見校舍圍繞的戶外廣場。開闊的地面與周邊空間，是認識校園環境的第一個視角。',question:'可以詢問戶外活動時段、陪伴方式，以及雨天的替代安排。'},
  {name:'遊戲設施',x:12,y:51,text:'照片左側可看見溜滑梯與遊戲設施。放大照片，看看設施與周邊活動空間的配置。',question:'參觀時可以了解設施適用年齡、使用方式與日常維護。'},
  {name:'校舍與走廊',x:66,y:26,text:'廣場周圍是校舍與走廊。從這個視角，可以先認識室內外空間的關係。',question:'教室配置、孩子移動路線與接送出入口，請向園所確認。'}]},
 {key:'garden',name:'綠色園藝',image:'garden',intro:'靠近一點，看看校園裡的自然細節。',spots:[
  {name:'觀察果實',x:52,y:62,text:'義華校官網的園藝照片記錄了枝葉間的果實。從顏色、形狀與大小開始，看看自然裡的小細節。',question:'可以詢問孩子接觸植物時的活動內容與陪伴方式。'},
  {name:'葉片與枝條',x:29,y:35,text:'綠葉、枝條與果實相互交錯。放大照片，可以看見平常容易忽略的葉片紋理。',question:'參觀時可以了解植物照顧、觀察或種植活動如何安排。'}]},
 {key:'classroom',name:'共創教室',image:'classroom',intro:'走進教室，認識孩子創作與學習的空間。',spots:[
  {name:'桌椅與共作空間',x:63,y:66,text:'教室照片中可以看見成排的桌椅與活動空間。這個視角呈現室內學習環境的配置。',question:'可以向園所了解分組方式，以及如何配合活動調整桌椅。'},
  {name:'材料收納',x:22,y:51,text:'照片左側的櫃架放置了多種材料。透過收納區，可以先認識教室內的素材與空間安排。',question:'參觀時可以詢問材料使用、收拾習慣與生活自理的練習。'},
  {name:'展示與教學區',x:45,y:44,text:'教室前方可見黑板與展示區。搭配完整照片，一起看看不同區域如何分布。',question:'各年齡層的教室與學習安排，請向園所確認。'}]}
];
function scenesFor(key){if(key==='yihua')return tourScenes;const c=campuses[key];return [{key:'exterior',name:'校園外觀',image:c.image,intro:`先從外觀與位置，認識${c.name}。`,spots:[{name:`認識${c.name}`,x:50,y:48,text:`${c.name}位於${c.address}。這張照片取自常春藤機構官網，歡迎放大觀察校園外觀。`,question:'室內環境、參觀動線與接送安排，可直接向園所詢問。'}]}];}
function campusTour(key,homePreview=false){const c=campuses[key],scenes=scenesFor(key);return `<section class="section tour-section" id="${homePreview?'campus-tour':'environment'}" aria-labelledby="tour-heading"><div class="container"><div class="section-heading"><div><span class="eyebrow">校園探索</span><h2 class="section-title" id="tour-heading">先走進校園，<br>再想像孩子的日常。</h2></div><p>點一下照片上的標記，<br>從你最感興趣的地方開始。</p></div><div class="tour-explorer" data-tour-campus="${key}"><div class="tour-toolbar"><div class="tour-location"><span class="tour-location-dot" aria-hidden="true"></span><strong>${c.name}</strong><span>照片探索</span></div><button type="button" class="tour-expand">${icon('arrows-out')}展開檢視</button></div><div class="tour-layout"><div class="tour-visual"><div class="tour-photo-area" role="group" tabindex="0" aria-label="校園照片，放大後可以使用方向鍵移動"><div class="tour-canvas"></div></div><div class="tour-image-tools"><p class="tour-image-help">點選標記，認識這個空間</p><div class="tour-zoom"><button type="button" data-tour-zoom="out" aria-label="縮小照片">${icon('minus')}</button><output class="tour-zoom-value" aria-label="照片縮放比例">100%</output><button type="button" data-tour-zoom="in" aria-label="放大照片">${icon('plus')}</button><button type="button" data-tour-zoom="reset">${icon('arrow-counter-clockwise')}重設</button></div></div><div class="tour-scene-list" role="tablist" aria-label="${c.name}照片場景">${scenes.map((scene,i)=>`<button type="button" class="tour-scene" id="tour-scene-${key}-${i}" role="tab" aria-controls="tour-scene-panel" aria-selected="${i===0}" tabindex="${i===0?0:-1}" data-tour-scene="${i}">${img(scene.image,'')}<span>${scene.name}</span></button>`).join('')}</div></div><div class="tour-detail" id="tour-scene-panel" role="tabpanel" aria-labelledby="tour-scene-${key}-0" tabindex="0"></div></div><div class="tour-footnote"><span>${homePreview?'本段為義華校實景；各校環境不同。':'照片取自校區官方網站，實際環境請以到園參觀為準。'}</span><a href="${bookingLink(key)}">預約參觀${c.name}</a></div></div>${homePreview?'<div class="tour-more"><a class="text-link" href="#/home/campuses">繼續認識其他校區</a></div>':''}</div></section>`;}
let disposeTour=()=>{};
function setupCampusTour(){
 const root=document.querySelector('.tour-explorer');if(!root)return;
 const key=root.dataset.tourCampus,scenes=scenesFor(key),area=root.querySelector('.tour-photo-area'),canvas=root.querySelector('.tour-canvas'),detail=root.querySelector('.tour-detail');
 const tabs=[...root.querySelectorAll('[data-tour-scene]')],expand=root.querySelector('.tour-expand');
 let sceneIndex=0,spotIndex=0,zoom=1,panX=0,panY=0,drag=null;const originalParent=root.parentNode;const placeholder=document.createComment('tour-position');root.before(placeholder);
 const fullDialog=document.createElement('dialog');fullDialog.className='tour-dialog';fullDialog.setAttribute('aria-label',campuses[key].name+'照片探索');document.body.append(fullDialog);
 function restore(){if(placeholder.isConnected)placeholder.after(root);root.classList.remove('expanded');expand.innerHTML=icon('arrows-out')+'展開檢視';expand.focus({preventScroll:true});transform();}
 fullDialog.addEventListener('close',restore);
 expand.addEventListener('click',()=>{if(fullDialog.open){fullDialog.close();return;}root.classList.add('expanded');expand.innerHTML=icon('x')+'返回頁面';fullDialog.append(root);fullDialog.showModal();zoom=1;panX=panY=0;transform();});
 function transform(){const maxX=area.clientWidth*(zoom-1)/2,maxY=area.clientHeight*(zoom-1)/2;panX=Math.max(-maxX,Math.min(maxX,panX));panY=Math.max(-maxY,Math.min(maxY,panY));canvas.style.transform=`translate(${panX}px,${panY}px) scale(${zoom})`;root.style.setProperty('--tour-pin-scale',String(1/zoom));area.classList.toggle('zoomed',zoom>1);root.querySelector('.tour-zoom-value').textContent=Math.round(zoom*100)+'%';root.querySelector('[data-tour-zoom="out"]').disabled=zoom===1;root.querySelector('[data-tour-zoom="in"]').disabled=zoom===2;root.querySelector('.tour-image-help').textContent=zoom>1?'拖曳照片，或用方向鍵移動':'點選標記，認識這個空間';}
 function selectSpot(index,focusDetail=false){spotIndex=index;const scene=scenes[sceneIndex],spot=scene.spots[index];canvas.querySelectorAll('.tour-pin').forEach((pin,i)=>pin.setAttribute('aria-pressed',String(index===i)));detail.innerHTML=`<div class="tour-detail-kicker"><span>${scene.name}</span><span>${String(index+1).padStart(2,'0')} / ${String(scene.spots.length).padStart(2,'0')}</span></div><h3 class="tour-spot-title" tabindex="-1">${spot.name}</h3><p class="tour-description">${spot.text}</p><div class="tour-observe"><span>到園時，還可以聊聊</span><p>${spot.question}</p></div><div class="tour-points"><span>這張照片裡</span>${scene.spots.map((s,i)=>`<button type="button" data-tour-spot="${i}" aria-pressed="${i===index}"><span>${String(i+1).padStart(2,'0')}</span>${s.name}<span aria-hidden="true">${i===index?'●':'○'}</span></button>`).join('')}</div><p class="tour-photo-credit">${campuses[key].name} · 官方實景照片</p>`;
  if(focusDetail){detail.querySelector('h3').focus({preventScroll:true});if(matchMedia('(max-width: 760px)').matches)detail.scrollIntoView({block:'nearest',behavior:'instant'});}
 }
 function selectScene(index,focusTab=false){sceneIndex=index;spotIndex=0;const scene=scenes[index];zoom=1;panX=panY=0;tabs.forEach((t,i)=>{t.setAttribute('aria-selected',String(i===index));t.tabIndex=i===index?0:-1;});detail.setAttribute('aria-labelledby',tabs[index].id);canvas.innerHTML=`${img(scene.image,campuses[key].name+' · '+scene.name,'tour-image',true)}${scene.spots.map((s,i)=>`<button type="button" class="tour-pin" style="left:${s.x}%;top:${s.y}%" data-tour-pin="${i}" aria-label="${i+1}：${s.name}" aria-pressed="${i===0}" aria-controls="tour-scene-panel"><span>${i+1}</span><span class="tour-pin-label">${s.name}</span></button>`).join('')}`;const photo=canvas.querySelector('img');photo.draggable=false;const fit=()=>{if(photo.naturalWidth){canvas.style.aspectRatio=photo.naturalWidth+'/'+photo.naturalHeight;transform();}};photo.addEventListener('load',fit,{once:true});if(photo.complete)fit();selectSpot(0);transform();if(focusTab)tabs[index].focus({preventScroll:true});}
 tabs.forEach((t,i)=>{t.addEventListener('click',()=>selectScene(i));t.addEventListener('keydown',e=>{let next;if(e.key==='ArrowRight')next=(i+1)%tabs.length;if(e.key==='ArrowLeft')next=(i+tabs.length-1)%tabs.length;if(e.key==='Home')next=0;if(e.key==='End')next=tabs.length-1;if(next!==undefined){e.preventDefault();selectScene(next,true);}});});
 canvas.addEventListener('click',e=>{const pin=e.target.closest('[data-tour-pin]');if(pin)selectSpot(Number(pin.dataset.tourPin),true);});
 detail.addEventListener('click',e=>{const button=e.target.closest('[data-tour-spot]');if(button){selectSpot(Number(button.dataset.tourSpot),true);}});
 root.querySelector('.tour-zoom').addEventListener('click',e=>{const b=e.target.closest('[data-tour-zoom]');if(!b)return;const action=b.dataset.tourZoom;zoom=action==='reset'?1:Math.min(2,Math.max(1,zoom+(action==='in'?.5:-.5)));if(zoom===1)panX=panY=0;transform();if(b.disabled)area.focus({preventScroll:true});});
 area.addEventListener('pointerdown',e=>{if(zoom===1||e.target.closest('button'))return;drag={id:e.pointerId,x:e.clientX,y:e.clientY,panX,panY};area.setPointerCapture(e.pointerId);area.classList.add('dragging');});
 area.addEventListener('pointermove',e=>{if(!drag||e.pointerId!==drag.id)return;panX=drag.panX+e.clientX-drag.x;panY=drag.panY+e.clientY-drag.y;transform();});
 const endDrag=()=>{drag=null;area.classList.remove('dragging');};area.addEventListener('pointerup',endDrag);area.addEventListener('pointercancel',endDrag);area.addEventListener('lostpointercapture',endDrag);
 area.addEventListener('keydown',e=>{if(e.target!==area||zoom===1)return;const directions={ArrowLeft:[40,0],ArrowRight:[-40,0],ArrowUp:[0,40],ArrowDown:[0,-40]};if(directions[e.key]){e.preventDefault();panX+=directions[e.key][0];panY+=directions[e.key][1];transform();}});
 const resize=new ResizeObserver(transform);resize.observe(area);selectScene(0);
 disposeTour=()=>{resize.disconnect();if(fullDialog.open)fullDialog.close();fullDialog.remove();placeholder.remove();disposeTour=()=>{};};
}

function campusPage(key){const c=campuses[key];return `<div class="container breadcrumb"><a href="#/home">首頁</a> / <a href="#/home/campuses">五校介紹</a> / ${c.name}</div><section class="hero campus-hero" style="--campus-photo-position:${c.heroPhotoPos||'center'}">${img(c.image,c.name+'校園外觀','hero-photo',true,true)}<div class="hero-shade"></div><div class="container"><span class="eyebrow">常春藤幼兒園 · 高雄${c.district}</span><h1>${c.name}</h1><p>${c.intro}</p><div class="hero-cta"><a class="button yellow" href="${bookingLink(key)}">預約參觀${c.name}</a></div></div><div class="hero-bottom"><span class="hero-caption">${c.name} · 官方校園照片</span></div></section><nav class="campus-subnav" aria-label="${c.name}頁面段落"><div class="container"><a href="#/${key}/about">認識${c.name}</a><a href="#/${key}/environment">校園環境</a><a href="#/${key}/faq">參觀須知</a><a href="#/${key}/contact">交通與聯絡</a></div></nav>
<section class="section" id="about"><div class="container detail-grid"><div><span class="eyebrow">認識${c.name}</span><h2 class="section-title">${c.intro}</h2><p class="section-copy">${c.description}</p><p class="section-copy">不急著做決定，先從一次親自走訪開始。帶著你想了解的事情，看看這裡是否適合孩子。</p></div><div class="contact-panel"><h3>來認識${c.name}</h3><dl><div><dt>${icon('map-pin')}所在地</dt><dd>${c.address}</dd></div><div><dt>${icon('phone')}參觀專線</dt><dd><a href="tel:${c.phone}">${c.phone}</a></dd></div><div><dt>${icon('clock')}到園參觀</dt><dd>請事先聯絡園所確認接待時間。</dd></div></dl><a class="text-link" href="${mapURL(c)}" ${external}>查看地圖與路線 ${arrow}</a></div></div></section>
${campusTour(key)}
<section class="section" id="faq"><div class="container faq-grid"><div><span class="eyebrow">參觀須知</span><h2 class="section-title">讓第一次參觀，<br>更安心一點。</h2><p class="section-copy">參觀時間、課程與入學安排，<br>請直接向${c.name}確認。</p></div>${faq(key)}</div></section>
<section class="section campuses" id="contact">${campusArtwork(key)}<div class="container detail-grid"><div class="contact-location"><span class="eyebrow">交通與聯絡</span><h2 class="section-title">我們在這裡，等你來。</h2><a class="phone-link" href="tel:${c.phone}">${icon('phone')}${c.phone}</a><p>${c.address}</p>${campusLinks(c)}<div><a class="button primary" href="${bookingLink(key)}">預約${c.name}</a></div></div>${campusMapFrame(c,'campus-contact-map')}</div></section>${banner(key)}`;}
function visitPage(key){return `<section class="visit-page"><div class="container"><div class="breadcrumb"><a href="#/home">首頁</a> / 預約校園參觀</div><div class="visit-layout"><div class="visit-intro"><span class="eyebrow">預約校園參觀</span><h1>一起認識，<br>孩子未來的日常。</h1><p>選一所你想了解的校園，<br>留下方便聯絡的方式。</p><p class="demo-note">這是官網互動提案，請使用測試資料。<br>資料不會送出或儲存，也不會建立預約。<br>實際參觀請直接致電各校。</p></div><div><ol class="stepper" aria-label="預約步驟"><li id="step-one" aria-current="step"><span>1</span>選擇校區</li><li id="step-two"><span>2</span>填寫聯絡資料</li></ol><div class="form-panel"><section id="choose-campus"><h2>想先認識哪所校園？</h2><p>依照你的生活圈與接送路線選擇。</p><form id="campus-form"><fieldset class="campus-options"><legend class="sr-only">選擇想參觀的校區（必填）</legend>${Object.entries(campuses).map(([id,c])=>`<label class="campus-option"><input type="radio" name="campus" value="${id}" ${key===id?'checked':''} required><span><strong>${c.name}</strong><small>${c.address}</small></span><span class="district">${c.district}</span></label>`).join('')}</fieldset><div class="form-buttons"><button class="button primary" type="submit">下一步：填寫資料${icon('arrow-right')}</button></div></form></section>
<section id="contact-step" hidden><h2 tabindex="-1" id="contact-title">怎麼稱呼你？</h2><div class="selected-school"><span id="selected-school-name"></span><button id="change-campus" type="button">更換校區</button></div><form id="booking-form"><div class="field-grid"><div class="field"><label for="parent-name">家長稱呼<span class="required">必填</span></label><input id="parent-name" name="parentName" autocomplete="off" maxlength="40" required placeholder="例如：陳媽媽"></div><div class="field"><label for="parent-phone">手機號碼<span class="required">必填</span></label><input id="parent-phone" name="phone" autocomplete="off" type="tel" inputmode="tel" maxlength="16" required pattern="09[0-9]{8}" title="09 開頭的 10 碼手機號碼" placeholder="09xxxxxxxx" aria-describedby="phone-hint"><small id="phone-hint">請填寫 09 開頭的 10 碼手機號碼。</small></div><div class="field"><label for="child-age">孩子年齡</label><select id="child-age" name="age"><option>尚未確定</option><option>2 歲以下</option><option>2–3 歲</option><option>3–4 歲</option><option>4–5 歲</option><option>5–6 歲</option></select></div><div class="field"><label for="contact-time">方便聯絡的時段</label><select id="contact-time" name="time"><option>時間彈性</option><option>平日上午</option><option>平日下午</option><option>其他，另行確認</option></select></div><div class="field full"><label for="questions">有沒有想先了解的事？<span class="required">選填</span></label><textarea id="questions" name="questions" maxlength="500" placeholder="例如：課程安排、生活照顧、入學準備……"></textarea></div></div><label class="consent"><input type="checkbox" required id="demo-consent"><span>我了解這是操作示範，資料不會傳送給學校，不代表預約成立。</span></label><p class="form-error" id="form-error" role="alert"></p><div class="form-buttons"><button type="button" class="button outline" id="back-step">${icon('arrow-left')}上一步</button><button type="submit" class="button primary">預覽填寫結果${icon('arrow-right')}</button></div></form></section><section id="booking-result" hidden tabindex="-1"><div class="result-mark" aria-hidden="true">${icon('check')}</div><span class="eyebrow">示範結果</span><h2>示範完成，尚未送出預約。</h2><p>以下為本次填寫內容。若要實際安排參觀，請撥打所選校區的電話；離開此頁後將清除輸入資料。</p><dl class="result-list" id="result-list"></dl><div class="form-buttons"><button class="button outline" type="button" id="edit-result">修改內容</button><a class="button primary" id="call-campus">${icon('phone')}致電園所</a></div><a class="text-link" style="margin-top:24px" href="#/home">回到首頁</a></section></div></div></div></div></section>`;}
function closeMenu(){nav.classList.remove('open');menu.setAttribute('aria-expanded','false');menu.setAttribute('aria-label','開啟導覽選單');}
menu.addEventListener('click',()=>{const open=nav.classList.toggle('open');menu.setAttribute('aria-expanded',String(open));menu.setAttribute('aria-label',open?'關閉導覽選單':'開啟導覽選單');});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&nav.classList.contains('open')){closeMenu();menu.focus();}});
window.matchMedia('(min-width: 901px)').addEventListener('change',closeMenu);
document.querySelector('#footer-campuses').innerHTML=Object.entries(campuses).map(([key,c])=>`<a href="#/${key}">${c.name}</a>`).join('');
function setupBooking(key){
 let selected=campuses[key]?key:'';
 const choose=document.querySelector('#choose-campus'),contact=document.querySelector('#contact-step'),result=document.querySelector('#booking-result');
 const form=document.querySelector('#booking-form');
 function step(n,focus=true){choose.hidden=n!==1;contact.hidden=n!==2;result.hidden=n!==3;document.querySelector('#step-one').toggleAttribute('aria-current',n===1);document.querySelector('#step-two').toggleAttribute('aria-current',n===2);if(n<3)document.querySelector(n===1?'#step-one':'#step-two').setAttribute('aria-current','step');if(n===2){document.querySelector('#selected-school-name').textContent=`${campuses[selected].name} · ${campuses[selected].district}`;}if(focus){const target=n===1?choose.querySelector('input:checked')||choose.querySelector('input'):n===2?document.querySelector('#contact-title'):result;target.focus({preventScroll:true});const panel=document.querySelector('.form-panel');if(panel.getBoundingClientRect().top<90||window.innerWidth<761)panel.scrollIntoView({block:'start',behavior:'instant'});}}
 document.querySelector('#campus-form').addEventListener('submit',e=>{e.preventDefault();selected=new FormData(e.currentTarget).get('campus');if(campuses[selected])step(2);});
 document.querySelector('#change-campus').addEventListener('click',()=>step(1));document.querySelector('#back-step').addEventListener('click',()=>step(1));document.querySelector('#edit-result').addEventListener('click',()=>step(2));
 const name=document.querySelector('#parent-name'),phone=document.querySelector('#parent-phone');
 name.addEventListener('input',()=>name.setCustomValidity(''));
 name.addEventListener('blur',()=>{name.value=name.value.trim();name.setCustomValidity(name.value?'':'請填寫家長稱呼。');});
 phone.addEventListener('input',()=>{phone.value=phone.value.replace(/[\s-]/g,'');});
 form.addEventListener('submit',e=>{e.preventDefault();name.value=name.value.trim();name.setCustomValidity(name.value?'':'請填寫家長稱呼。');if(!form.reportValidity())return;const c=campuses[selected];const data=new FormData(form);const values=[['想參觀的校區',c.name],['家長稱呼',data.get('parentName')],['手機號碼',data.get('phone')],['孩子年齡',data.get('age')],['方便聯絡時段',data.get('time')],['想了解的事',data.get('questions').trim()||'未填寫']];const dl=document.querySelector('#result-list');dl.replaceChildren();for(const [title,value] of values){const div=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=title;dd.textContent=value;div.append(dt,dd);dl.append(div);}document.querySelector('#call-campus').href='tel:'+c.phone;step(3);});
 if(selected)step(2,false);
}
function setupVideo(){
 if(!HERO_VIDEO_SRC)return;
 const video=document.querySelector('#hero-video'),controls=document.querySelector('#video-controls'),play=document.querySelector('#video-play');
 if(!video)return;
 let disposed=false,wantsPlayback=false,revealVisible=true;
 const reduce=matchMedia('(prefers-reduced-motion: reduce)');
 const sync=()=>{const label=video.paused?'播放影片':'暫停影片';play.innerHTML=icon(video.paused?'play':'pause')+`<span class="sr-only">${label}</span>`;play.title=label;};
 const start=()=>{wantsPlayback=true;if(!disposed&&!document.hidden&&revealVisible)video.play().catch(()=>{if(!disposed)sync();});};
 const setVisible=visible=>{revealVisible=visible;if(disposed)return;if(document.hidden||!visible)video.pause();else if(wantsPlayback)start();};
 video.muted=true;
 video.addEventListener('play',sync);
 video.addEventListener('pause',sync);
 video.addEventListener('error',()=>{
  if(disposed)return;
  wantsPlayback=false;video.hidden=true;controls.hidden=true;
 });
 video.src=HERO_VIDEO_SRC;
 video.hidden=false;controls.hidden=false;
 play.addEventListener('click',()=>{if(video.paused)start();else{wantsPlayback=false;video.pause();}});
 sync();
 const conn=navigator.connection,frugal=conn?.saveData||/^(slow-2g|2g|3g)$/.test(conn?.effectiveType||'');
 if(!reduce.matches&&!frugal)start();
 const visibility=()=>setVisible(revealVisible);
 const onMotion=()=>{if(reduce.matches){wantsPlayback=false;video.pause();}};
 document.addEventListener('visibilitychange',visibility);
 reduce.addEventListener('change',onMotion);
 disposeMedia=()=>{
  disposed=true;
  document.removeEventListener('visibilitychange',visibility);
  reduce.removeEventListener('change',onMotion);
  video.pause();video.removeAttribute('src');video.load();
 };
 return setVisible;
}
let disposeHomeReveal=()=>{};
function setupHomeReveal(setMediaVisible=()=>{}){
 const root=document.querySelector('.home-reveal');if(!root)return;
 const track=root.querySelector('.home-reveal-track'),hero=root.querySelector('.studio-hero');
 const copy=root.querySelector('.studio-hero-copy'),image=root.querySelector('.studio-hero-image');
 const media=root.querySelector('.studio-media'),actions=root.querySelector('.studio-actions');
 const reduce=matchMedia('(prefers-reduced-motion: reduce)'),mobile=matchMedia('(max-width: 1000px)');
 const native=CSS.supports('animation-timeline: view()')&&CSS.supports('animation-range: contain 0% contain 100%');
 const clamp=n=>Math.max(0,Math.min(1,n));
 let disposed=false,frame=0,measureFrame=0,start=0,distance=1,copyRise=0,lastVisible;
 function update(){
  frame=0;if(disposed)return;
  const animated=root.dataset.motion!=='still',progress=animated?clamp((scrollY-start)/distance):0;
  root.classList.toggle('is-revealing',animated&&progress>.08);
  hero.inert=animated&&progress>=.995;
  actions.inert=animated&&progress>=.15;
  media.inert=animated&&progress>=.2;
  if(root.dataset.motion==='fallback'){
   const fade=clamp(progress/.48);
   hero.style.clipPath=`inset(0 0 ${clamp((progress-.1)/.9)*100}% 0)`;
   hero.style.setProperty('--reveal-film-opacity',String(1-fade));
   image.style.opacity=String(1-fade);
   copy.style.opacity=String(1-(mobile.matches ? .72 : .75)*fade);
   copy.style.transform=`translateY(${-copyRise*fade}px) scale(${1-(mobile.matches ? .04 : .1)*fade})`;
   copy.style.color=`rgb(${255-223*fade} ${253-190*fade} ${245-195*fade})`;
   media.style.opacity=String(1-clamp(progress/.2));
  }
  const rect=hero.getBoundingClientRect();
  const visible=animated?progress<1:rect.bottom>0&&rect.top<document.documentElement.clientHeight;
  if(visible!==lastVisible){lastVisible=visible;setMediaVisible(visible);}
 }
 function schedule(){if(!disposed&&!frame)frame=requestAnimationFrame(update);}
 function measure(){
  measureFrame=0;if(disposed)return;
  root.dataset.motion='still';
  [hero,copy,image,media].forEach(el=>el.removeAttribute('style'));
  const height=document.documentElement.clientHeight;
  copyRise=mobile.matches?height*.2:0;
  // Only fall back when the content really exceeds the available viewport.
  const fits=hero.getBoundingClientRect().height<=height+1;
  root.style.setProperty('--reveal-height',height+'px');
  root.dataset.motion=reduce.matches||!fits||document.documentElement.classList.contains('hero-quiet')?'still':native?'native':'fallback';
  const rect=track.getBoundingClientRect();start=rect.top+scrollY;distance=Math.max(1,rect.height-height);
  update();
 }
 function scheduleMeasure(){if(!disposed&&!measureFrame)measureFrame=requestAnimationFrame(measure);}
 window.addEventListener('scroll',schedule,{passive:true});
 window.addEventListener('resize',scheduleMeasure,{passive:true});
 reduce.addEventListener('change',measure);mobile.addEventListener('change',measure);
 const observer=new ResizeObserver(scheduleMeasure);observer.observe(copy);
 document.fonts.ready.then(()=>{if(!disposed)measure();});
 measure();
 disposeHomeReveal=()=>{
  disposed=true;cancelAnimationFrame(frame);cancelAnimationFrame(measureFrame);observer.disconnect();
  window.removeEventListener('scroll',schedule);window.removeEventListener('resize',scheduleMeasure);
  reduce.removeEventListener('change',measure);mobile.removeEventListener('change',measure);
  disposeHomeReveal=()=>{};
 };
}
let disposeCampusShowcase=()=>{};
function setupCampusShowcase(){
 const root=document.querySelector('.campuses');if(!root||!root.querySelector('.campus-track'))return;
 const tabs=[...root.querySelectorAll('.campus-seg')],keys=tabs.map(t=>t.dataset.campus);
 const stage=root.querySelector('#campus-stage'),media=root.querySelector('.campus-stage-media'),photo=root.querySelector('.campus-stage-photo'),info=root.querySelector('.campus-stage-info'),svg=root.querySelector('.campus-map-svg'),route=root.querySelector('.map-embed-link'),live=root.querySelector('#campus-live');
 const reduce=matchMedia('(prefers-reduced-motion:reduce)');
 const interval=6000;
 let current=keys.find(k=>root.querySelector(`#campus-tab-${k}`).getAttribute('aria-selected')==='true')||keys[0],switchId=0;
 let hovered=root.matches(':hover'),touching=false,visible=false,disposed=false,timer=0,transitionTimer=0;
 function syncPlayback(){
  clearTimeout(timer);
  const active=document.activeElement;
  const focused=active!==root&&root.contains(active)&&active.matches(':focus-visible');
  const paused=reduce.matches||hovered||touching||focused;
  live.setAttribute('aria-live',paused?'polite':'off');
  if(disposed||paused||!visible||document.hidden)return;
  timer=setTimeout(()=>{select(keys[(keys.indexOf(current)+1)%keys.length],false,false);syncPlayback();},interval);
 }
 function apply(c,key){photo.src=photoSrc(c.image);photo.alt=c.name+'校園外觀';media.style.setProperty('--photo-pos',c.photoPos||'center');media.style.setProperty('--panorama-pos',c.panoramaPos||'center 55%');info.innerHTML=campusStageInfo(c);root.querySelector('.campus-stage-actions').innerHTML=campusStageActions(c,key);root.querySelector('.campus-art-building').src=campusArtSrc(key);}
 function select(key,focusTab=false,announce=true){
  const c=campuses[key];
  tabs.forEach(t=>{const on=t.dataset.campus===key;t.setAttribute('aria-selected',String(on));t.tabIndex=on?0:-1;if(on&&focusTab)t.focus({preventScroll:true});});
  if(key===current)return;
  current=key;stage.setAttribute('aria-labelledby','campus-tab-'+key);
  svg.querySelectorAll('.campus-map-pin').forEach(p=>{const on=p.dataset.campus===key;p.classList.toggle('is-selected',on);if(on)svg.append(p);});
  svg.setAttribute('aria-label','五校位置示意圖，目前標示'+c.name);route.href=dirURL(c);
  live.textContent=announce?`目前顯示 ${c.name}，高雄${c.district}`:'';
  // 照片與校舍線稿先預載、內容淡出後一起換；減少動態時直接換。
  const token=++switchId,next=new Image(),nextArt=new Image();next.src=photoSrc(c.image);nextArt.src=campusArtSrc(key);
  const ready=Promise.all([next.decode().catch(()=>{}),nextArt.decode().catch(()=>{})]);
  clearTimeout(transitionTimer);
  if(reduce.matches){apply(c,key);stage.classList.remove('is-switching');return;}
  stage.classList.add('is-switching');
  const done=()=>{if(disposed||token!==switchId)return;apply(c,key);requestAnimationFrame(()=>{if(!disposed&&token===switchId)stage.classList.remove('is-switching');});};
  transitionTimer=setTimeout(()=>{ready.then(done);},200);
 }
 function onClick(e){
  syncPlayback();
  const tab=e.target.closest('.campus-seg');if(tab){select(tab.dataset.campus);return;}
  const step=e.target.closest('.campus-stage-btn');if(step){const i=keys.indexOf(current);select(keys[(i+Number(step.dataset.step)+keys.length)%keys.length]);return;}
  const pin=e.target.closest('.campus-map-pin');if(pin)select(pin.dataset.campus,true);
 }
 function onKey(e){const tab=e.target.closest('.campus-seg');if(!tab)return;const i=keys.indexOf(tab.dataset.campus);const next={ArrowRight:i+1,ArrowLeft:i-1,Home:0,End:keys.length-1}[e.key];if(next===undefined)return;e.preventDefault();syncPlayback();select(keys[(next+keys.length)%keys.length],true);}
 const onPointerDown=e=>{touching=e.pointerType!=='mouse';syncPlayback();};
 const onPointerEnd=()=>{if(touching){touching=false;syncPlayback();}};
 const onFocus=()=>queueMicrotask(()=>{if(!disposed)syncPlayback();});
 const onEnter=e=>{if(e.pointerType==='mouse'){hovered=true;syncPlayback();}};
 const onLeave=e=>{if(e.pointerType==='mouse'){hovered=false;syncPlayback();}};
 const onMotion=()=>syncPlayback();
 const observer=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting&&entries[0].intersectionRatio>=.2;syncPlayback();},{threshold:[0,.2]});
 observer.observe(stage);
 root.addEventListener('click',onClick);root.addEventListener('keydown',onKey);
 root.addEventListener('pointerdown',onPointerDown);document.addEventListener('pointerup',onPointerEnd);document.addEventListener('pointercancel',onPointerEnd);
 root.addEventListener('focusin',onFocus);root.addEventListener('focusout',onFocus);root.addEventListener('pointerenter',onEnter);root.addEventListener('pointerleave',onLeave);
 document.addEventListener('visibilitychange',syncPlayback);reduce.addEventListener('change',onMotion);
 syncPlayback();
 disposeCampusShowcase=()=>{
  disposed=true;++switchId;clearTimeout(timer);clearTimeout(transitionTimer);observer.disconnect();
  root.removeEventListener('click',onClick);root.removeEventListener('keydown',onKey);
  root.removeEventListener('pointerdown',onPointerDown);document.removeEventListener('pointerup',onPointerEnd);document.removeEventListener('pointercancel',onPointerEnd);
  root.removeEventListener('focusin',onFocus);root.removeEventListener('focusout',onFocus);root.removeEventListener('pointerenter',onEnter);root.removeEventListener('pointerleave',onLeave);
  document.removeEventListener('visibilitychange',syncPlayback);reduce.removeEventListener('change',onMotion);
  disposeCampusShowcase=()=>{};
 };
}
const dialog=document.querySelector('#photo-dialog');document.querySelector('#photo-close').addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>{lastPhotoTrigger?.focus({preventScroll:true});});dialog.addEventListener('click',e=>{if(e.target!==dialog)return;const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();});
main.addEventListener('click',e=>{const trigger=e.target.closest('[data-photo]');if(!trigger)return;lastPhotoTrigger=trigger;document.querySelector('#photo-title').textContent=trigger.dataset.title;document.querySelector('#photo-image').src='assets/'+trigger.dataset.photo+'.webp';document.querySelector('#photo-image').alt=trigger.dataset.title;dialog.showModal();});
function render(){const version=++routeVersion;const parts=location.hash.replace(/^#\/?/,'').split('/');let page=parts[0]||'home';if(!campuses[page]&&page!=='visit')page='home';const school=page==='visit'&&campuses[parts[1]]?parts[1]:'';const id=page==='visit'?'':parts[1]||'';const pageKey=page+(page==='visit'?'/'+school:'');closeMenu();homepageNews.close();if(currentPage!==pageKey){disposeTour();disposeHomeReveal();disposeMedia();disposeMedia=()=>{};disposeCampusShowcase();if(dialog.open)dialog.close();currentPage=pageKey;main.innerHTML=page==='home'?home():page==='visit'?visitPage(school):campusPage(page);document.title=page==='home'?'常春藤幼兒園｜每一天都有新發現':page==='visit'?'預約校園參觀｜常春藤幼兒園':campuses[page].name+'｜常春藤幼兒園';document.querySelector('.header-book').href=bookingLink(campuses[page]?page:'');if(page==='visit')setupBooking(school);if(page==='home'){setupDayExperience();setupHomeReveal(setupVideo());setupCampusShowcase();}setupCampusTour();armMapFrames(main);}document.querySelectorAll('.nav-inner a').forEach(a=>{if(a.getAttribute('href')===location.hash)a.setAttribute('aria-current','location');else a.removeAttribute('aria-current');});requestAnimationFrame(()=>{if(version!==routeVersion)return;const target=id?document.getElementById(id):null;if(target){target.scrollIntoView({block:'start',behavior:'instant'});target.setAttribute('tabindex','-1');target.focus({preventScroll:true});}else{window.scrollTo({top:0,behavior:'instant'});main.focus({preventScroll:true});}});}
homepageNews.init();
window.addEventListener('hashchange',render);document.addEventListener('click',e=>{const a=e.target.closest('a[href^="#/"]');if(a&&a.getAttribute('href')===location.hash){e.preventDefault();render();}});render();
