"""agenda_shared — utilities baked into every agent container.

Exposes the Charm Hyper client, Postgres access, the Redis event bus, and the
BaseAgent / Flask factory so each agent module is a thin subclass.
"""
