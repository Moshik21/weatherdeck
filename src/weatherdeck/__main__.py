"""`python -m weatherdeck` (with src on the path), same as bin/weatherdeck."""
import sys

from .cli import main

sys.exit(main())
