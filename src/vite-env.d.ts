/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TEXTALIVE_TOKEN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
