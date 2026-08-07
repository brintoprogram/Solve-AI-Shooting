/// <reference types="vite/client" />

// Este arquivo não existia. Sem ele o TypeScript não conhece `import.meta.env`,
// e as 34 leituras de variável de ambiente espalhadas pelo app viravam erro
// "Property 'env' does not exist on type 'ImportMeta'".
//
// A declaração abaixo vai além do que `vite/client` oferece: lá `env` aceita
// qualquer chave string, então um nome escrito errado compila e só falha em
// runtime, como `undefined` silencioso. Listando as chaves, errar o nome vira
// erro de compilação.
//
// A interface faz merge com a do `vite/client`, então DEV, PROD e MODE
// continuam disponíveis sem precisar repeti-los aqui.

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL:      string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_APP_DOMAIN?:       string;
  readonly VITE_META_APP_ID?:      string;
  readonly VITE_META_CONFIG_ID?:   string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
