from anvil import *

from ._anvil_designer import AppChipTemplate
from ... import vb


class AppChip(AppChipTemplate):
    """The app a video is about: colour square + name (VB.appChip)."""

    def __init__(self, **properties):
        self._product = None
        self._ready = False
        super().__init__(**properties)
        self._ready = True
        self._draw()

    def _draw(self):
        if self._ready:
            self.dom_nodes["host"].innerHTML = vb.app_chip_html(self._product)

    @property
    def product(self):
        return self._product

    @product.setter
    def product(self, value):
        self._product = value
        self._draw()
