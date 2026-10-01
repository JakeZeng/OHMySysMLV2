-- M16 P5/Q10：画布布局后端持久化（独立表，最小侵入）。
--
-- 文本（content）仍是唯一语义真源；layout 只是呈现辅助。
-- 独立表 + 独立 endpoint（PUT/GET /api/v1/layouts/:kind/:id）：
--   - 不 bump version，不触发协同 409
--   - 不触碰 packages/views 的 SELECT/Scan 链
-- layout JSON：{ "<nodeId>": {"x": <num>, "y": <num>}, ... }
-- kind：'package' | 'view'（scopeId 的实体类型）

CREATE TABLE IF NOT EXISTS entity_layouts (
    entity_kind TEXT    NOT NULL,
    entity_id   TEXT    NOT NULL,
    layout      TEXT    NOT NULL,
    updated_at  TIMESTAMP NOT NULL,
    PRIMARY KEY (entity_kind, entity_id)
);
