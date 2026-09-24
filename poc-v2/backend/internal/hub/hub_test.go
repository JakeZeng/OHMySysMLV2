package hub

import (
	"testing"
	"time"
)

func TestHub_PublishSubscribe(t *testing.T) {
	h := New()
	sub := h.Subscribe("package:abc", 4)
	defer sub.Unsubscribe()

	h.Publish("package:abc", Event{Type: "presence", Data: "test"})

	select {
	case ev := <-sub.Channel():
		if ev.Type != "presence" {
			t.Errorf("event type 错误: %s", ev.Type)
		}
		if ev.Data != "test" {
			t.Errorf("event data 错误: %v", ev.Data)
		}
	case <-time.After(time.Second):
		t.Fatal("1s 内未收到事件")
	}
}

func TestHub_MultipleSubscribers(t *testing.T) {
	h := New()
	s1 := h.Subscribe("scope:1", 4)
	s2 := h.Subscribe("scope:1", 4)
	s3 := h.Subscribe("scope:2", 4) // 不同 scope
	defer s1.Unsubscribe()
	defer s2.Unsubscribe()
	defer s3.Unsubscribe()

	h.Publish("scope:1", Event{Type: "test", Data: 42})

	for _, sub := range []*Subscription{s1, s2} {
		select {
		case ev := <-sub.Channel():
			if ev.Type != "test" {
				t.Errorf("订阅者应收到 test 事件")
			}
		case <-time.After(time.Second):
			t.Fatal("订阅者未收到事件")
		}
	}

	// s3 应不收到
	select {
	case ev := <-s3.Channel():
		t.Fatalf("s3 不应收到 scope:1 的事件，got %+v", ev)
	case <-time.After(100 * time.Millisecond):
		// OK
	}
}

func TestHub_SlowConsumerDrop(t *testing.T) {
	h := New()
	sub := h.Subscribe("slow", 2) // buffer=2
	defer sub.Unsubscribe()

	// 发布 10 个事件，订阅者不读
	for i := 0; i < 10; i++ {
		h.Publish("slow", Event{Type: "burst", Data: i})
	}

	// 读 buffer 中的事件：buffer=2 + 已丢弃 8
	received := 0
Drain:
	for {
		select {
		case <-sub.Channel():
			received++
		default:
			break Drain
		}
	}
	if received > 3 {
		t.Errorf("慢消费者应只收到最多 buffer 大小的事件，got %d", received)
	}
}

func TestHub_UnsubscribeIdempotent(t *testing.T) {
	h := New()
	sub := h.Subscribe("x", 4)
	sub.Unsubscribe()
	sub.Unsubscribe() // 不应 panic
}

func TestHub_Stats(t *testing.T) {
	h := New()
	s1 := h.Subscribe("a", 4)
	s2 := h.Subscribe("a", 4)
	s3 := h.Subscribe("b", 4)
	defer s1.Unsubscribe()
	defer s2.Unsubscribe()
	defer s3.Unsubscribe()

	scopes, subs := h.Stats()
	if scopes != 2 {
		t.Errorf("期望 2 scopes，got %d", scopes)
	}
	if subs != 3 {
		t.Errorf("期望 3 subs，got %d", subs)
	}
}
