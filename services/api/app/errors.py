"""Domain errors mapped to HTTP status codes in app.main."""

from __future__ import annotations


class DomainError(Exception):
    status_code = 400

    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


class NotFound(DomainError):
    status_code = 404


class Conflict(DomainError):
    status_code = 409


class Invalid(DomainError):
    status_code = 422


class Forbidden(DomainError):
    status_code = 403


class Unauthorized(DomainError):
    status_code = 401


class TooLarge(DomainError):
    status_code = 413


class RateLimited(DomainError):
    status_code = 429
