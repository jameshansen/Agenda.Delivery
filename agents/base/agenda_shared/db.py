"""Thin Postgres access — a connection pool + three helpers.

No ORM (that was the point of the restructure). Every container that
touches the DB imports these.
"""
from psycopg_pool import ConnectionPool
from psycopg.rows import dict_row

from .settings import DATABASE_URL

# ponytail: one small pool per container; bump max_size if a container
# starts saturating it. open=True connects eagerly so a bad DATABASE_URL
# fails fast at boot instead of on first request.
pool = ConnectionPool(
    DATABASE_URL,
    min_size=1,
    max_size=5,
    kwargs={"row_factory": dict_row},
    open=True,
)


def query(sql: str, params: tuple | None = None) -> list[dict]:
    """Run a SELECT, return all rows as dicts."""
    with pool.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchall()


def one(sql: str, params: tuple | None = None) -> dict | None:
    """Run a SELECT, return the first row (or None)."""
    with pool.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchone()


def execute(sql: str, params: tuple | None = None) -> dict | None:
    """Run an INSERT/UPDATE/DELETE. Returns the first row if the SQL has a
    RETURNING clause, else None. Autocommits."""
    with pool.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            row = cur.fetchone() if cur.description else None
        conn.commit()
        return row
