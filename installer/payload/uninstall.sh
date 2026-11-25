#!/bin/sh
# Removes Safe Context from this Mac (#26). Run with sudo:
#
#   sudo "/Library/Application Support/SafeContext/uninstall.sh"            # keep people's data
#   sudo "/Library/Application Support/SafeContext/uninstall.sh" --purge    # also each person's
#        saved placeholder keys, swap record, logs and Keychain items
#
# IT's MDM profile is removed with the MDM tool, not here.
set -e
if [ "$(id -u)" -ne 0 ]; then
	echo "Run it with sudo." >&2
	exit 1
fi
label=com.safecontext.agent

for home in /Users/*; do
	user=$(basename "$home")
	uid=$(id -u "$user" 2>/dev/null) || continue
	launchctl bootout "gui/$uid/$label" 2>/dev/null || true
	if [ "$1" = --purge ]; then
		rm -rf "$home/Library/Application Support/SafeContext" "$home/Library/Logs/SafeContext"
		# The Keychain items (device id and token, placeholder key encryption) belong to the user.
		while sudo -u "$user" security delete-generic-password -s com.safecontext.agent >/dev/null 2>&1; do :; done
	fi
done

rm -f /Library/LaunchAgents/com.safecontext.agent.plist
[ "$(readlink /usr/local/bin/safecontext 2>/dev/null)" = "/Library/Application Support/SafeContext/bin/safecontext" ] && rm -f /usr/local/bin/safecontext
rm -rf "/Library/Application Support/SafeContext"
pkgutil --forget com.safecontext.agent >/dev/null 2>&1 || true
echo "Safe Context is removed."
