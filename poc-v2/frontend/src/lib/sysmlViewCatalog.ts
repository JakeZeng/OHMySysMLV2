/**
 * M19：标准视图目录的前端入口 —— 纯 re-export。
 *
 * 单一真源在 `poc-v2/views/sysmlViewCatalog.ts`（core 层），parser / validator /
 * Go 端镜像都从那里取；前端这里只做转发，改动请改 core 那份。
 */

export * from '@views/sysmlViewCatalog';