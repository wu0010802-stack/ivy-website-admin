from __future__ import annotations


class SlotFull(Exception):
    pass


class InvalidTransition(Exception):
    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(message)
