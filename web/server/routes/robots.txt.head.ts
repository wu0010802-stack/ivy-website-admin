// HEAD 和 GET 走同一支 handler（見 robots.txt.get.ts）：Nitro 的 *.get.ts 只配 GET，探活用 HEAD 會 404。
export { default } from './robots.txt.get'
