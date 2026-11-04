#!/bin/sh
# Installs the three Macrohard demo personas (dev, pm, sales) to ~/macrohard, or to --dir.
#
#   demo/setup.sh              # install to ~/macrohard
#   demo/setup.sh --dir PATH   # install somewhere else
#   demo/setup.sh --force      # replace an existing install (the old one is moved aside, not deleted)
#
# Each persona folder gets a .claude/settings.json that turns the Safe Context plugin on for that
# folder only, loaded from this repo's local marketplace (.claude-plugin/marketplace.json). The
# folders live outside the repo so Claude Code doesn't also load the repo's own CLAUDE.md.
#
# Fake API keys are generated here, at install time, so the repo itself holds no secret-shaped
# strings (GitHub push protection would refuse them).
set -eu

REPO=$(cd "$(dirname "$0")/.." && pwd)
TARGET="$HOME/macrohard"
FORCE=0
while [ $# -gt 0 ]; do
	case "$1" in
		--dir) TARGET="$2"; shift 2 ;;
		--force) FORCE=1; shift ;;
		*) echo "unknown option: $1" >&2; exit 2 ;;
	esac
done

if [ -e "$TARGET" ]; then
	if [ "$FORCE" -ne 1 ]; then
		echo "$TARGET already exists. Run again with --force to replace it (the old copy is moved aside)." >&2
		exit 1
	fi
	BACKUP="$TARGET.bak-$(date +%Y%m%d-%H%M%S)"
	mv "$TARGET" "$BACKUP"
	echo "Moved the old install to $BACKUP"
fi

mkdir -p "$TARGET"
cp -R "$REPO/demo/personas/." "$TARGET/"

# --- Fake keys ---------------------------------------------------------------------------------
rand() { LC_ALL=C tr -dc "$1" </dev/urandom | head -c "$2"; }
STRIPE_KEY="sk_live_$(rand 'A-Za-z0-9' 24)"
AWS_KEY_ID="AKIA$(rand 'A-Z2-7' 16)"
GITHUB_PAT="ghp_$(rand 'A-Za-z0-9' 36)"
SLACK_WEBHOOK="https://hooks.slack.com/services/T$(rand 'A-Z0-9' 8)/B$(rand 'A-Z0-9' 10)/$(rand 'A-Za-z0-9' 24)"
DB_PASSWORD=$(rand 'A-Za-z0-9' 20)

fill() {
	sed -e "s|__FAKE_STRIPE_KEY__|$STRIPE_KEY|g" \
		-e "s|__FAKE_AWS_KEY_ID__|$AWS_KEY_ID|g" \
		-e "s|__FAKE_GITHUB_PAT__|$GITHUB_PAT|g" \
		-e "s|__FAKE_SLACK_WEBHOOK__|$SLACK_WEBHOOK|g" \
		-e "s|__FAKE_DB_PASSWORD__|$DB_PASSWORD|g" "$1" >"$2"
	rm "$1"
}

DEV="$TARGET/dev"
fill "$DEV/env.template" "$DEV/.env"
fill "$DEV/scripts/notify-deploy.sh.template" "$DEV/scripts/notify-deploy.sh"
chmod +x "$DEV/scripts/notify-deploy.sh"
mv "$DEV/gitignore.template" "$DEV/.gitignore"

# --- Turn the plugin on in each persona folder -------------------------------------------------
for persona in dev pm sales; do
	mkdir -p "$TARGET/$persona/.claude"
	cat >"$TARGET/$persona/.claude/settings.json" <<EOF
{
	"extraKnownMarketplaces": {
		"safecontext": {
			"source": { "source": "directory", "path": "$REPO" }
		}
	},
	"enabledPlugins": {
		"safe-context@safecontext": true
	}
}
EOF
done

# --- The dev persona is a git repo, like a real service ------------------------------------------
git -C "$DEV" init -q -b main
git -C "$DEV" add -A
git -C "$DEV" -c user.name="Macrohard Dev" -c user.email="dev@macrohard.example" \
	commit -q -m "orders-api 3.8.1"

# --- Guide ---------------------------------------------------------------------------------------
if node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)' 2>/dev/null; then
	node "$REPO/demo/check.ts" --list --dir "$TARGET" >"$TARGET/TRY-THESE.md"
else
	echo "Skipped TRY-THESE.md: needs Node 24 (run 'nvm use' in the repo, then this script again with --force)." >&2
fi

cat <<EOF

Installed the Macrohard personas to $TARGET:
  dev    $TARGET/dev     orders-api, a checkout service (git repo, fake keys in .env)
  pm     $TARGET/pm      Priya Shah, product manager for Macrohard Flow
  sales  $TARGET/sales   Marcus Reid, enterprise account executive

Next:
  1. Start the agent:   $REPO/demo/start-agent.sh
  2. Open a persona in Claude Code, e.g.  cd $TARGET/pm && claude
     (or pick the folder in the desktop app). Trust the folder when asked.
  3. Run /safe-context:status, then try the prompts in $TARGET/TRY-THESE.md
EOF
