#!/usr/bin/env bash
# Cuts a release from a maintainer's machine. There is no release pipeline: nothing is published unless you run this.
#
#   scripts/release.sh prepare  X.Y.Z   Bump every version and cut the changelog on release/vX.Y.Z, then open a PR to dev.
#   scripts/release.sh check    X.Y.Z   Run every pre-publish check and build the bundle. Publishes nothing (a dry run).
#   scripts/release.sh publish  X.Y.Z   Check, then build, scan, sign and push the images, push the tag, create the
#                                       GitHub release and publish the npm package. Rolls back by itself if a step fails.
#   scripts/release.sh rollback X.Y.Z   Remove whatever exists of a release: npm version, GitHub release, tag, images.
#
# Options: --yes (no confirmation prompts), --ignore-ci (run lint, typecheck and unit tests here instead of requiring a
# green CI run on the release commit), --no-rollback (on failure, leave what was published so you can inspect it).
#
# Needs: git, node/npm, gh, jq, docker with buildx, cosign and trivy. One-time setup is in CONTRIBUTING.md
# ("Cutting a release"). Environment:
#   COSIGN_KEY        private signing key (default ~/.config/sdlc-agent/cosign.key); its public half is ./cosign.pub
#   COSIGN_PASSWORD   the key's password; asked for once if unset
#   GH_TOKEN          a classic token with repo, write:packages and delete:packages (default: the gh login)
set -euo pipefail
cd "$(dirname "$0")/.."

REPO=${SDLC_RELEASE_REPO:-pjx16/sdlc-agent}
OWNER=${REPO%%/*}
REGISTRY=ghcr.io/$OWNER
NPM_PACKAGE=sdlc-agent
COSIGN_KEY=${COSIGN_KEY:-$HOME/.config/sdlc-agent/cosign.key}
BUILDER=sdlc-release
PLATFORMS=linux/amd64,linux/arm64

# name|build context|Dockerfile. Published as $REGISTRY/sdlc-agent-<name>. The agent image is never published: it bundles
# Claude Code, which is not ours to redistribute, so installs build it from the bundle's docker/agent folder.
IMAGES=(
  "api|.|apps/api/Dockerfile"
  "worker|.|docker/worker/Dockerfile"
  "dashboard|.|apps/dashboard/Dockerfile"
  "broker|.|apps/broker/Dockerfile"
  "proxy|docker/proxy|docker/proxy/Dockerfile"
  "docker-proxy|docker/socket-proxy|docker/socket-proxy/Dockerfile"
  "npm-mirror|docker/npm-mirror|docker/npm-mirror/Dockerfile"
)

# ---------------------------------------------------------------------------------------------------------------- helpers

log() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[33mwarning:\033[0m %s\n' "$*" >&2; }
die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

confirm() {
  [ "$YES" = 1 ] && return 0
  local answer
  read -r -p "$1 [y/N] " answer
  [[ "$answer" =~ ^[Yy] ]]
}

# The state file records what a publish has done (image digests, the npm dist-tag it replaced), so a rollback can undo
# it, including images that were pushed by digest but never tagged.
state_set() { printf '%s=%s\n' "$1" "$2" >> "$STATE"; }
state_get() { [ -f "$STATE" ] && sed -n "s/^$1=//p" "$STATE" | tail -n 1 || true; }

changelog_notes() {
  awk -v header="## [$VERSION]" '
    index($0, header) == 1 { found = 1; next }
    found && /^## \[/ { exit }
    found { print }
  ' CHANGELOG.md
}

gh_token() { printf '%s' "${GH_TOKEN:-$(gh auth token)}"; }

docker_login() {
  gh_token | docker login ghcr.io -u "$(GH_TOKEN=$(gh_token) gh api user --jq .login)" --password-stdin >/dev/null
}

# ------------------------------------------------------------------------------------------------------------- arguments

COMMAND=${1:-}
VERSION=${2:-}
shift $(( $# < 2 ? $# : 2 ))
YES=0 IGNORE_CI=0 NO_ROLLBACK=0
for arg in "$@"; do
  case "$arg" in
    --yes) YES=1 ;;
    --ignore-ci) IGNORE_CI=1 ;;
    --no-rollback) NO_ROLLBACK=1 ;;
    *) die "unknown option: $arg" ;;
  esac
done
[[ "$COMMAND" =~ ^(prepare|check|publish|rollback)$ ]] || { sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'; exit 1; }
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]] || die "the version must look like 0.1.0 or 0.1.0-rc.1, not '$VERSION'"

TAG=v$VERSION
WORK=.release/$TAG
STATE=$WORK/state
case "$VERSION" in *-*) DIST_TAG=next ;; *) DIST_TAG=latest ;; esac
# While the major version is 0 every GitHub release is marked as a pre-release.
case "$VERSION" in 0.*) PRERELEASE=true ;; *) PRERELEASE=false ;; esac

require_tools() {
  local missing=()
  for tool in "$@"; do command -v "$tool" >/dev/null || missing+=("$tool"); done
  [ ${#missing[@]} -eq 0 ] || die "missing tools: ${missing[*]} (brew install ${missing[*]})"
}

require_clean_dev() {
  [ -z "$(git status --porcelain)" ] || die "the working tree has uncommitted changes"
  [ "$(git branch --show-current)" = dev ] || die "switch to dev first (git switch dev)"
  git fetch --quiet origin dev
  [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/dev)" ] || die "dev is not the same as origin/dev; pull or push first"
}

# --------------------------------------------------------------------------------------------------------------- prepare

cmd_prepare() {
  require_tools git gh node npm
  require_clean_dev
  git switch -c "release/$TAG"
  scripts/bump-version.sh "$VERSION"
  git add package.json package-lock.json apps/*/package.json packages/*/package.json CHANGELOG.md \
    plugins/sdlc-subagents/.claude-plugin/plugin.json .claude-plugin/marketplace.json
  git commit -s -m "chore(release): $TAG"
  # Everything bump-version.sh changed must be in the release commit; a file left behind would ship the old version.
  [ -z "$(git status --porcelain)" ] || die "bump-version.sh changed files that were not committed: $(git status --porcelain | tr '\n' ' ')"
  git push -u origin "release/$TAG"
  gh pr create --repo "$REPO" --base dev --title "chore(release): $TAG" --body "Sets every workspace version and the \`sdlc-subagents\` plugin version to \`$VERSION\`, pins the marketplace to \`$TAG\` (plugin installs fail from merge until \`publish\` pushes the tag, so publish soon after), and moves the \`[Unreleased]\` changelog entries under \`[$VERSION]\`. Check the notes: they become the GitHub release notes.

After merge: \`git switch dev && git pull && scripts/release.sh publish $VERSION\`"
  echo
  echo "Review and merge the pull request, then run: git switch dev && git pull && scripts/release.sh publish $VERSION"
}

# ----------------------------------------------------------------------------------------------------------------- check

cmd_check() {
  log "Checking that $TAG can be released"
  require_tools git gh jq node npm docker cosign trivy shasum zip
  require_clean_dev

  local cli_version
  cli_version=$(node -p "require('./packages/cli/package.json').version")
  [ "$cli_version" = "$VERSION" ] || die "packages/cli/package.json is $cli_version; run scripts/release.sh prepare $VERSION and merge it first"
  local plugin_version
  plugin_version=$(node -p "require('./plugins/sdlc-subagents/.claude-plugin/plugin.json').version")
  [ "$plugin_version" = "$VERSION" ] || die "plugins/sdlc-subagents/.claude-plugin/plugin.json is $plugin_version; run scripts/release.sh prepare $VERSION and merge it first"
  # The marketplace installs the plugin from this release's tag, so it must name it.
  local plugin_ref
  plugin_ref=$(node -p "require('./.claude-plugin/marketplace.json').plugins.find((p) => p.name === 'sdlc-subagents').source.ref")
  [ "$plugin_ref" = "$TAG" ] || die ".claude-plugin/marketplace.json pins sdlc-subagents to $plugin_ref, not $TAG; run scripts/release.sh prepare $VERSION and merge it first"
  changelog_notes | grep -q '[^[:space:]]' || die "CHANGELOG.md has no notes under '## [$VERSION]'"

  git tag -l "$TAG" | grep -q . && die "the tag $TAG already exists locally (git tag -d $TAG, or roll back)"
  git ls-remote --exit-code --tags origin "refs/tags/$TAG" >/dev/null && die "the tag $TAG already exists on origin (scripts/release.sh rollback $VERSION)"
  gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1 && die "a GitHub release $TAG already exists (scripts/release.sh rollback $VERSION)"
  [ -z "$(npm view "$NPM_PACKAGE@$VERSION" version 2>/dev/null)" ] || die "$NPM_PACKAGE@$VERSION is already on npm; npm never lets a version be reused, so pick another"

  # Accounts and permissions.
  npm whoami >/dev/null 2>&1 || die "not logged in to npm (npm login)"
  local scopes
  scopes=$(GH_TOKEN=$(gh_token) gh api -i user 2>/dev/null | tr -d '\r' | sed -n 's/^[Xx]-[Oo][Aa]uth-[Ss]copes: //p')
  for scope in write:packages delete:packages; do
    [[ ", $scopes," == *", $scope,"* ]] || die "the GitHub token lacks $scope (gh auth refresh -s write:packages,delete:packages, or set GH_TOKEN)"
  done
  docker info >/dev/null 2>&1 || die "Docker is not running"

  # Signing key: it must exist, unlock, and match the committed cosign.pub that users verify against.
  [ -f cosign.pub ] || die "cosign.pub is missing from the repository; see 'Cutting a release' in CONTRIBUTING.md"
  [ -f "$COSIGN_KEY" ] || die "no signing key at $COSIGN_KEY (set COSIGN_KEY)"
  if [ -z "${COSIGN_PASSWORD+set}" ]; then
    read -rs -p "Password for $COSIGN_KEY: " COSIGN_PASSWORD; echo
    export COSIGN_PASSWORD
  fi
  [ "$(cosign public-key --key "$COSIGN_KEY" 2>/dev/null | tr -d '[:space:]')" = "$(tr -d '[:space:]' < cosign.pub)" ] \
    || die "$COSIGN_KEY does not unlock with that password, or does not match cosign.pub"

  # The release commit must have passed CI, which runs lint, typecheck, unit, integration and e2e tests.
  local sha conclusion
  sha=$(git rev-parse HEAD)
  if [ "$IGNORE_CI" = 1 ]; then
    warn "--ignore-ci: running lint, typecheck and unit tests here instead (no integration or e2e tests)"
    npm ci
    npm run lint
    npm run typecheck
    npm test
  else
    conclusion=$(gh run list --repo "$REPO" --workflow ci.yml --commit "$sha" --json conclusion --jq '[.[] | .conclusion][0] // ""')
    [ "$conclusion" = success ] || die "CI on $sha is '${conclusion:-not run}', not 'success' (wait for it, or pass --ignore-ci)"
    # Dependencies' install scripts never run in the shell that is about to publish to npm.
    npm ci --ignore-scripts
  fi
  npm run build -w "$NPM_PACKAGE"

  build_bundle
  log "$TAG is ready to publish (bundle in $WORK/dist)"
}

build_bundle() {
  log "Building the install bundle"
  local dir=sdlc-agent-$VERSION
  rm -rf "$WORK/dist" && mkdir -p "$WORK/dist/$dir/docker"
  (
    cd "$WORK/dist"
    local root=../../..
    cp "$root/deploy/docker-compose.yml" "$dir/docker-compose.yml"
    # The agent image is built on the user's machine (docker compose --profile build build agent-image).
    cp -R "$root/docker/agent" "$dir/docker/agent"
    sed "s/^SDLC_VERSION=.*/SDLC_VERSION=$VERSION/" "$root/.env.example" > "$dir/.env.example"
    cp -R "$root/guidelines" "$dir/guidelines"
    for f in LICENSE README.md CHANGELOG.md SECURITY.md THIRD_PARTY_NOTICES.md; do cp "$root/$f" "$dir/"; done
    COPYFILE_DISABLE=1 tar -czf "$dir.tar.gz" "$dir"
    # The sdlc-subagents Claude Code plugin, for installs without the marketplace (claude --plugin-dir). It is generated
    # by `npm run agents` and committed; a test fails when it drifts, so it is zipped as it is in the repository. Its
    # version was checked against $VERSION in cmd_check.
    (cd "$root/plugins" && zip -qrX "$OLDPWD/sdlc-subagents-$VERSION.zip" sdlc-subagents -x '*.DS_Store')
    shasum -a 256 "$dir.tar.gz" "sdlc-subagents-$VERSION.zip" > SHA256SUMS
    cat SHA256SUMS
  )
}

# --------------------------------------------------------------------------------------------------------------- publish

PUBLISHING=0

# Runs on every exit once publishing starts, so a failed command, a die and Ctrl-C all end in a rollback.
on_exit() {
  local code=$?
  [ "$PUBLISHING" = 1 ] || exit "$code"
  PUBLISHING=0
  echo
  warn "the release failed part way. Done so far is recorded in $STATE"
  if [ "$NO_ROLLBACK" = 1 ]; then
    warn "--no-rollback: nothing was undone. Clean up with: scripts/release.sh rollback $VERSION"
  else
    warn "rolling back"
    YES=1 cmd_rollback || true
  fi
  exit "$code"
}

cmd_publish() {
  cmd_check

  local sha short
  sha=$(git rev-parse HEAD)
  short=$(git rev-parse --short=7 HEAD)
  echo
  echo "About to release $TAG from $sha:"
  echo "  images    $REGISTRY/sdlc-agent-{api,worker,dashboard,broker,proxy,docker-proxy,npm-mirror}:$VERSION"
  echo "  tag       $TAG, pushed to origin"
  echo "  release   GitHub release $TAG (pre-release: $PRERELEASE) with the bundle and sdlc-subagents-$VERSION.zip"
  echo "  npm       $NPM_PACKAGE@$VERSION under the '$DIST_TAG' dist-tag"
  confirm "Publish?" || die "stopped; nothing was published"

  mkdir -p "$WORK"
  : > "$STATE"
  state_set commit "$sha"
  PUBLISHING=1
  trap on_exit EXIT
  trap 'exit 130' INT TERM

  docker_login
  docker buildx inspect "$BUILDER" >/dev/null 2>&1 || docker buildx create --name "$BUILDER" --driver docker-container >/dev/null

  # Images are pushed by digest only. They get their version tag after every one is scanned and signed, so a failed
  # release never leaves a pullable $VERSION tag behind.
  local entry name context file image digest created
  created=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  for entry in "${IMAGES[@]}"; do
    IFS='|' read -r name context file <<< "$entry"
    image=$REGISTRY/sdlc-agent-$name
    log "Building $image ($PLATFORMS)"
    # No layer cache, and always the latest base image: a cached apt/apk layer would never pick up security fixes,
    # and the scan below would judge a stale image.
    docker buildx build --builder "$BUILDER" --platform "$PLATFORMS" --file "$file" \
      --no-cache --pull --provenance mode=max --sbom true \
      --label "org.opencontainers.image.source=https://github.com/$REPO" \
      --label "org.opencontainers.image.version=$VERSION" \
      --label "org.opencontainers.image.revision=$sha" \
      --label "org.opencontainers.image.created=$created" \
      --label "org.opencontainers.image.licenses=MIT" \
      --annotation "index:org.opencontainers.image.source=https://github.com/$REPO" \
      --annotation "index:org.opencontainers.image.licenses=MIT" \
      --output "type=image,name=$image,push-by-digest=true,name-canonical=true,push=true" \
      --metadata-file "$WORK/$name.json" "$context"
    digest=$(jq -r '."containerimage.digest"' "$WORK/$name.json")
    [[ "$digest" == sha256:* ]] || die "no digest for $image in $WORK/$name.json"
    state_set "digest_$name" "$digest"
  done

  for entry in "${IMAGES[@]}"; do
    IFS='|' read -r name _ _ <<< "$entry"
    image=$REGISTRY/sdlc-agent-$name
    digest=$(state_get "digest_$name")
    for platform in ${PLATFORMS//,/ }; do
      log "Scanning $image ($platform)"
      trivy image --quiet --platform "$platform" --severity CRITICAL,HIGH --ignore-unfixed --exit-code 1 "$image@$digest"
    done
  done

  for entry in "${IMAGES[@]}"; do
    IFS='|' read -r name _ _ <<< "$entry"
    image=$REGISTRY/sdlc-agent-$name
    digest=$(state_get "digest_$name")
    log "Signing and tagging $image:$VERSION"
    cosign sign --yes --key "$COSIGN_KEY" "$image@$digest"
    docker buildx imagetools create --builder "$BUILDER" --tag "$image:$VERSION" --tag "$image:sha-$short" "$image@$digest"
  done

  log "Pushing the tag $TAG"
  git tag -a "$TAG" -m "$TAG" "$sha"
  git push origin "refs/tags/$TAG"

  log "Creating the GitHub release"
  changelog_notes > "$WORK/notes.md"
  local flags=()
  if [ "$PRERELEASE" = true ]; then flags+=(--prerelease); fi
  # ${flags[@]+...}: bash 3.2 (macOS) treats an empty array as unbound under set -u.
  GH_TOKEN=$(gh_token) gh release create "$TAG" --repo "$REPO" --title "$TAG" --notes-file "$WORK/notes.md" --verify-tag ${flags[@]+"${flags[@]}"} \
    "$WORK/dist/sdlc-agent-$VERSION.tar.gz" "$WORK/dist/sdlc-subagents-$VERSION.zip" "$WORK/dist/SHA256SUMS" cosign.pub

  # Last, because it is the one step a rollback cannot fully undo: npm never allows a version number to be used twice.
  echo
  confirm "Everything else is published. Publish $NPM_PACKAGE@$VERSION to npm? No rolls back the whole release; a rollback after yes burns the version number." \
    || die "stopped before npm"
  state_set npm_previous "$(npm view "$NPM_PACKAGE" "dist-tags.$DIST_TAG" 2>/dev/null || true)"
  log "Publishing $NPM_PACKAGE@$VERSION to npm ($DIST_TAG)"
  npm publish -w "$NPM_PACKAGE" --access public --tag "$DIST_TAG"
  state_set npm_published 1

  PUBLISHING=0
  log "Released $TAG: https://github.com/$REPO/releases/tag/$TAG"
}

# -------------------------------------------------------------------------------------------------------------- rollback

# Deletes the GHCR versions of one image that belong to this release: the version tagged $VERSION (with its sha- tag),
# the per-platform and attestation manifests inside it, untagged digests recorded by a failed publish, and the cosign
# signature. A version that carries any other tag is never deleted.
delete_image_versions() {
  local name=$1 package=sdlc-agent-$1 image=$REGISTRY/sdlc-agent-$1 versions digests=() digest
  if ! versions=$(GH_TOKEN=$(gh_token) gh api --paginate "/users/$OWNER/packages/container/$package/versions" | jq -s 'add // []'); then
    warn "could not list the versions of $package (no access to $OWNER's packages, or it was never published)"
    return 1
  fi

  digest=$(jq -r --arg v "$VERSION" '.[] | select(.metadata.container.tags | index($v)) | .name' <<< "$versions" | head -n 1)
  [ -n "$digest" ] || digest=$(state_get "digest_$name")
  [ -n "$digest" ] || return 0
  digests+=("$digest")
  # The index lists the platform images and buildx's attestation manifests; GHCR stores each as an untagged version.
  while read -r child; do [ -n "$child" ] && digests+=("$child"); done < <(
    docker buildx imagetools inspect --raw "$image@$digest" 2>/dev/null | jq -r '.manifests[]?.digest' || true)

  local ids
  ids=$(jq -r --arg v "$VERSION" --argjson d "$(printf '%s\n' "${digests[@]}" | jq -R . | jq -s .)" '
    ($d | map("sha256-" + ltrimstr("sha256:"))) as $sigs
    | .[] | .name as $n | .metadata.container.tags as $tags
    | select(any($d[]; . == $n) or any($tags[]; . as $t | any($sigs[]; . as $s | $t | startswith($s))))
    | select(all($tags[]; . == $v or startswith("sha-") or startswith("sha256-")))
    | .id' <<< "$versions")
  for id in $ids; do
    GH_TOKEN=$(gh_token) gh api -X DELETE "/users/$OWNER/packages/container/$package/versions/$id" >/dev/null \
      && echo "  deleted $package version $id" || warn "could not delete $package version $id"
  done
}

cmd_rollback() {
  require_tools git gh jq npm docker
  echo "Rolling back $TAG. This removes, where they exist:"
  echo "  $NPM_PACKAGE@$VERSION on npm (unpublished, or deprecated if npm refuses), the GitHub release $TAG,"
  echo "  the tag $TAG on origin and locally, and every $REGISTRY/sdlc-agent-* image of this release."
  echo "  The release commit on dev stays."
  confirm "Roll back?" || die "stopped; nothing was changed"

  if [ -n "$(npm view "$NPM_PACKAGE@$VERSION" version 2>/dev/null)" ]; then
    log "Removing $NPM_PACKAGE@$VERSION from npm"
    if npm unpublish "$NPM_PACKAGE@$VERSION"; then
      local previous
      previous=$(state_get npm_previous)
      if [ -n "$previous" ] && [ "$(npm view "$NPM_PACKAGE" "dist-tags.$DIST_TAG" 2>/dev/null)" != "$previous" ]; then
        npm dist-tag add "$NPM_PACKAGE@$previous" "$DIST_TAG" || warn "could not point '$DIST_TAG' back at $previous"
      fi
    else
      warn "npm refused to unpublish (over 72 hours old, or depended on); deprecating it instead"
      npm deprecate "$NPM_PACKAGE@$VERSION" "Withdrawn; do not use $VERSION." || warn "could not deprecate $NPM_PACKAGE@$VERSION"
    fi
    warn "npm will never accept $VERSION again: the next attempt needs a new version number"
  fi

  if GH_TOKEN=$(gh_token) gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
    log "Deleting the GitHub release $TAG"
    GH_TOKEN=$(gh_token) gh release delete "$TAG" --repo "$REPO" --yes || warn "could not delete the GitHub release"
  fi
  if git ls-remote --exit-code --tags origin "refs/tags/$TAG" >/dev/null 2>&1; then
    log "Deleting the tag $TAG on origin"
    git push origin --delete "refs/tags/$TAG" || warn "could not delete the remote tag"
  fi
  git tag -l "$TAG" | grep -q . && git tag -d "$TAG" >/dev/null

  log "Deleting the images of $TAG"
  docker_login || warn "could not log Docker in to ghcr.io; platform manifests may be left behind"
  local entry name
  for entry in "${IMAGES[@]}"; do
    IFS='|' read -r name _ _ <<< "$entry"
    delete_image_versions "$name" || warn "could not clean up sdlc-agent-$name"
  done

  [ -f "$STATE" ] && mv "$STATE" "$STATE.rolled-back"
  log "Rolled back $TAG"
}

"cmd_$COMMAND"
