/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly WORKATO_WEBHOOK_URL?: string;
	readonly VITE_WORKATO_DEV_BASIC_AUTH_USER?: string;
	readonly VITE_WORKATO_DEV_BASIC_AUTH_PASSWORD?: string;
	readonly VITE_WORKATO_DEV_HEADER_API_KEY_NAME?: string;
	readonly VITE_WORKATO_DEV_HEADER_API_KEY_VALUE?: string;
	readonly VITE_LOCAL_CHAT_AGENT_URL?: string;
	readonly VITE_LOCAL_CHAT_AGENT_API_KEY_NAME?: string;
	readonly VITE_LOCAL_CHAT_AGENT_API_KEY_VALUE?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
