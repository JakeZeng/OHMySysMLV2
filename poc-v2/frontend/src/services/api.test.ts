/**
 * api.test.ts — 共享 API 客户端的请求拦截器契约
 *
 * ## 为什么要单独测 FormData 这一条
 *
 * `createApi()` 给实例设了默认 `Content-Type: application/json`。axios 看到它
 * 就走 JSON 序列化分支，于是 `FormData` 被 `JSON.stringify` 成
 * `{"file":{},"projectId":"abc"}` 发出去 —— file 变成空对象。
 * 服务端 `c.Request.FormFile("file")` / `c.PostForm("projectId")` 拿到空值，
 * 直接 400「缺少 projectId」。
 *
 * 也就是说**所有走这个客户端的文件上传都是坏的**，M6 的 Papyrus / Capella
 * 导入首当其冲。修法是请求时把 Content-Type 整个删掉、交给浏览器生成带
 * boundary 的 multipart —— 这条测试就是防止它再退化回去。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createApi } from './api';

/** 把拦截器里注入逻辑跑一遍，返回最终的 config（等价于 axios 实际发出的形态） */
function runRequestInterceptor(data: unknown, method = 'post') {
  const api = createApi();
  const handlers = (
    api.interceptors.request as unknown as { handlers: Array<{ fulfilled: (c: unknown) => unknown }> }
  ).handlers;
  const config = {
    method,
    headers: { 'Content-Type': 'application/json' } as Record<string, string>,
    data,
  };
  return handlers[0].fulfilled(config) as typeof config & {
    headers: Record<string, string>;
  };
}

beforeEach(() => {
  // 让 localStorage / document 不存在，聚焦拦截器本身
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    configurable: true,
  });
  Object.defineProperty(globalThis, 'document', {
    value: { cookie: '' },
    configurable: true,
  });
});

describe('createApi 请求拦截器', () => {
  it('FormData：删掉 Content-Type，让浏览器自己生成 multipart boundary', () => {
    const fd = new FormData();
    fd.append('projectId', 'p1');

    const cfg = runRequestInterceptor(fd);

    expect(cfg.headers['Content-Type']).toBeUndefined();
    expect(cfg.headers['content-type']).toBeUndefined();
  });

  it('普通 JSON 对象：保留 application/json 默认值', () => {
    const cfg = runRequestInterceptor({ name: 'x' });

    expect(cfg.headers['Content-Type']).toBe('application/json');
  });

  it('FormData 的字段本身不被改动（只是不再被 JSON 序列化）', () => {
    const fd = new FormData();
    fd.append('projectId', 'p1');
    fd.append('file', new Blob(['{}']), 'a.json');

    const cfg = runRequestInterceptor(fd);

    expect(cfg.data).toBe(fd);
    expect((cfg.data as FormData).get('projectId')).toBe('p1');
  });

  it('非 mutating 方法不注入 CSRF header', () => {
    const cfg = runRequestInterceptor({ a: 1 }, 'get');

    expect(cfg.headers['X-CSRF-Token']).toBeUndefined();
  });
});
