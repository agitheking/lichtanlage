from pathlib import Path

PACKAGE_DIR = Path(__file__).resolve().parent
ROOT_DIR = PACKAGE_DIR.parent
DEFAULTS_DIR = PACKAGE_DIR / "defaults"
STATIC_DIR = ROOT_DIR / "static"
DEFAULT_DATA_DIR = ROOT_DIR / "data"

DMX_FPS = 40
DMX_CHANNELS = 512
RECONNECT_INTERVAL_S = 2.0
STATE_AUTOSAVE_S = 5.0

ENTTEC_BY_ID_GLOB = "/dev/serial/by-id/usb-ENTTEC_DMX_USB_PRO_*"
FTDI_VID = 0x0403
FTDI_PID = 0x6001
