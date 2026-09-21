// Nitro treats the trailing slash as equivalent; serve the entry point for both.
export { default } from './admin/[...path].get'
