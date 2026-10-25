"""Explanations for alerts and patients behind a swappable provider.

The UI renders whatever provider is configured through one contract (ExplanationOut). Today the
rule-based TemplateProvider is used; a local language-model provider can be added by
implementing `ExplanationProvider` and registering it in `registry.py`. Every provider's output
passes `guard.check`, which enforces citations and fixed workflow wording.
"""
