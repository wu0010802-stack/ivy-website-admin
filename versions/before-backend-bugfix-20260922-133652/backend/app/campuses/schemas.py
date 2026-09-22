from __future__ import annotations

from pydantic import BaseModel


class CampusOut(BaseModel):
    key: str
    name: str
    active: bool

    model_config = {"from_attributes": True}
