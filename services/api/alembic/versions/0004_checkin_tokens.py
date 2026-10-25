"""patient check-in tokens

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-24 19:55:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import app.db


revision: str = '0004'
down_revision: Union[str, None] = '0003'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('checkin_tokens',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('patient_id', sa.String(length=16), nullable=False),
    sa.Column('token_hash', sa.String(length=64), nullable=False),
    sa.Column('issued_by', sa.String(length=40), nullable=False),
    sa.Column('issued_at', app.db.UTCDateTime(), nullable=False),
    sa.Column('expires_at', app.db.UTCDateTime(), nullable=False),
    sa.Column('revoked_at', app.db.UTCDateTime(), nullable=True),
    sa.Column('revoked_by', sa.String(length=40), nullable=True),
    sa.Column('revoke_reason', sa.String(length=16), nullable=True),
    sa.ForeignKeyConstraint(['patient_id'], ['patients.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('token_hash')
    )


def downgrade() -> None:
    op.drop_table('checkin_tokens')
