import type { InjectionKey } from 'vue'

/**
 * ContentEditor 提供給工具列裡的 CampusSelect：多校下拉也在框內寫出「校區」，
 * 分校內容頁一眼看得出現在改的是哪一校（單校時本來就有這個標籤）。
 * 單獨放一個檔：CampusSelect 各頁都用，不必為了這個 key 載入內容頁的 composable。
 */
export const campusSelectLabelKey: InjectionKey<string> = Symbol('campusSelectLabel')
