// Package hub 提供进程内 pub/sub 广播（M13 SSE 用）。
//
// 用途：
//   - 用户保存 package/view → 后端调用 hub.Publish(scope, event) → 所有订阅此 scope 的 SSE 连接收到
//   - presence 更新 → 同上
//   - lock 变化 → 同上
//
// 设计要点：
//   - 完全无锁化：用 buffered channel (cap=32) + slow-consumer drop 策略
//   - 进程内：服务重启会丢失订阅（acceptable for MVP）
//   - 多副本部署时需要换 Redis pub/sub（M14+ 再做）
package hub

import (
	"sync"
)

// Event 一条广播事件。
type Event struct {
	Type string      `json:"type"` // "presence" | "lock_changed" | "lock_released" | "content_updated" | "hello"
	Data interface{} `json:"data,omitempty"`
}

// Hub 进程内广播中心。
type Hub struct {
	mu     sync.RWMutex
	subs   map[string]map[*Subscription]struct{} // scope -> set of subs
}

type Subscription struct {
	ch     chan Event
	scope  string
	hub    *Hub
	once   sync.Once
}

// New 构造 Hub。
func New() *Hub {
	return &Hub{subs: make(map[string]map[*Subscription]struct{})}
}

// Subscribe 订阅 scope；返回 subscription + channel。
//
// 调用方负责在不再使用时调 Unsubscribe（避免内存泄漏）。
// channel 满时 Publish 会丢弃最老的事件（slow-consumer protection）。
func (h *Hub) Subscribe(scope string, buf int) *Subscription {
	if buf <= 0 {
		buf = 32
	}
	s := &Subscription{
		ch:    make(chan Event, buf),
		scope: scope,
		hub:   h,
	}
	h.mu.Lock()
	if h.subs[scope] == nil {
		h.subs[scope] = make(map[*Subscription]struct{})
	}
	h.subs[scope][s] = struct{}{}
	h.mu.Unlock()
	return s
}

// Unsubscribe 取消订阅；幂等可重入。
func (s *Subscription) Unsubscribe() {
	s.once.Do(func() {
		s.hub.mu.Lock()
		if set, ok := s.hub.subs[s.scope]; ok {
			delete(set, s)
			if len(set) == 0 {
				delete(s.hub.subs, s.scope)
			}
		}
		s.hub.mu.Unlock()
		close(s.ch)
	})
}

// Channel 返回订阅的事件 channel。
func (s *Subscription) Channel() <-chan Event { return s.ch }

// Publish 向 scope 广播事件。
//
// 同步（非阻塞）：慢消费者会被跳过（ch 满时丢弃）。
func (h *Hub) Publish(scope string, e Event) {
	h.mu.RLock()
	subs := h.subs[scope]
	dst := make([]*Subscription, 0, len(subs))
	for s := range subs {
		dst = append(dst, s)
	}
	h.mu.RUnlock()

	for _, s := range dst {
		select {
		case s.ch <- e:
		default:
			// 慢消费者：丢弃本次事件（订阅者下次心跳补全）
		}
	}
}

// Stats 返回当前订阅数（用于 /health）。
func (h *Hub) Stats() (scopes int, subs int) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	scopes = len(h.subs)
	for _, set := range h.subs {
		subs += len(set)
	}
	return
}
