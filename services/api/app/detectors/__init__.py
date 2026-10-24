"""Threshold, trend and hybrid detectors — implemented in Phase 3.

Detectors create alerts only through app.services.alerts.create_alert so every
alert carries detector name, version, dedup key and evidence event ids.
"""
