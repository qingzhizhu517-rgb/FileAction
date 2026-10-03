// 默认移除存储相关展示；后续开发可通过构建环境重新开启，底层能力继续保留。
export const CLOUD_UI_ENABLED = import.meta.env.VITE_FILEACTION_CLOUD_UI === 'true';
