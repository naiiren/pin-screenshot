UUID := pin-screenshot@naiiren
EXTENSION_DIR := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)

.PHONY: check pack install
check:
	node --check extension.js
	node --check prefs.js
	glib-compile-schemas --strict --dry-run schemas
	python3 -m json.tool metadata.json > /dev/null

pack: check
	mkdir -p dist
	gnome-extensions pack --force --out-dir=dist .

install: check
	mkdir -p "$(EXTENSION_DIR)"
	install -m 644 extension.js prefs.js metadata.json stylesheet.css "$(EXTENSION_DIR)/"
	mkdir -p "$(EXTENSION_DIR)/schemas"
	install -m 644 schemas/*.xml "$(EXTENSION_DIR)/schemas/"
	glib-compile-schemas --strict "$(EXTENSION_DIR)/schemas"
	@echo 'Installed. Log out and back in, then run: gnome-extensions enable $(UUID)'
