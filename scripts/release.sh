#!/usr/bin/env bash
# Cuts and publishes a build of RPE.
#
#   scripts/release.sh cut <alpha|beta|rc|stable> [--dry-run]
#   scripts/release.sh publish
#
# cut: the committed tree is built in a clean checkout (.verify/) and checked: the generated documents are
# current, src typechecks, the build says its own id, and two builds are the same. The built files are then
# written to the install repository, which is the one Lumiverse installs RPE from and holds nothing else. Its
# channel branches carry the names of the branches here that a build is cut from: alpha (from release/A.B.C),
# dev (beta and rc, from dev), main (stable, from main). The source commit and the built-files commit get the
# same tag, v<VERSION>-<type> (no suffix for stable). Nothing leaves this machine. --dry-run stops once the
# built tree is assembled and writes nothing outside .verify/.
#
# publish: pushes exactly what the last cut made: this repository's branch and tag, and the install
# repository's built-files commit to its channel with the tag. Cut first, play the build in the environment,
# then publish.
#
# VERSION (A.B.C.D.aa) at the root names the build. Environment: BUN (the Bun to build with, default bun),
# RPE_INSTALL_REPO (default ../lumirpengine).
set -euo pipefail

say() { printf '%s\n' "$*"; }
die() { printf 'release: %s\n' "$*" >&2; exit 2; }

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
BUN="${BUN:-bun}"
# The package's scripts start `bun` themselves, so a Bun named by path leads PATH too.
case "$BUN" in */*) PATH="$(dirname "$BUN"):$PATH"; export PATH ;; esac
INSTALL="${RPE_INSTALL_REPO:-$ROOT/../lumirpengine}"
V="$ROOT/.verify"
LAST="$V.last-cut"

sums() { (cd "$1" && find . -type f | LC_ALL=C sort | while read -r f; do if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$f"; else sha256sum "$f"; fi; done); }

publish() {
  [ -f "$LAST" ] || die "nothing cut here waits to be published"
  local TAG="" CHANNEL="" BRANCH="" SRC="" BUILT=""
  # shellcheck disable=SC1090
  . "$LAST"
  # The record names commits, and only those are pushed: a branch that has moved since is refused, not published.
  [ "$(git -C "$ROOT" rev-parse -q --verify "refs/tags/$TAG^{commit}" || true)" = "$SRC" ] || die "the tag $TAG in this repository is not on the commit that was cut ($SRC)"
  [ "$(git -C "$INSTALL" rev-parse -q --verify "refs/tags/$TAG^{commit}" || true)" = "$BUILT" ] || die "the tag $TAG in the install repository is not on the built files that were cut ($BUILT)"
  [ "$(git -C "$INSTALL" rev-parse -q --verify "refs/heads/$CHANNEL" || true)" = "$BUILT" ] || die "the channel $CHANNEL has moved since the cut: it is not the build that was played"
  git -C "$ROOT" merge-base --is-ancestor "$SRC" "refs/heads/$BRANCH" || die "the branch $BRANCH no longer holds the commit that was cut"
  git -C "$INSTALL" push --atomic origin "$BUILT:refs/heads/$CHANNEL" "refs/tags/$TAG"
  git -C "$ROOT" push --atomic origin "refs/heads/$BRANCH" "refs/tags/$TAG"
  rm -f "$LAST"
  say "published $TAG: source $BRANCH, channel $CHANNEL"
}

cut() {
  local type="${1:-}" dry=0
  [ "${2:-}" = "--dry-run" ] && dry=1
  local channel branch
  branch="$(git rev-parse --abbrev-ref HEAD)"
  case "$type" in
    alpha) channel=alpha; case "$branch" in release/*) ;; *) die "an alpha build is cut from a release/A.B.C branch, and this is $branch" ;; esac ;;
    beta | rc) channel=dev; [ "$branch" = dev ] || die "a $type build is cut from dev, and this is $branch" ;;
    stable) channel=main; [ "$branch" = main ] || die "a stable build is cut from main, and this is $branch" ;;
    *) die "the type is alpha, beta, rc or stable" ;;
  esac
  [ -z "$(git status --porcelain)" ] || die "the tree has changes that are not committed"
  local version; version="$(tr -d ' \n\r' < VERSION)"
  printf '%s' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+\.[0-9]{2}$' || die "VERSION is not A.B.C.D.aa: $version"
  local a b c d aa
  IFS=. read -r a b c d aa <<EOF
$version
EOF
  local src id tag
  src="$(git rev-parse HEAD)"; id="$(git rev-parse --short=8 HEAD)"
  tag="v$version"; [ "$type" = stable ] || tag="$tag-$type"
  if [ "$dry" = 0 ]; then
    [ -f "$LAST" ] && die "a cut waits to be published or thrown away ($LAST): publish it, or undo it as the cut-build skill says"
    git rev-parse -q --verify "refs/tags/$tag" >/dev/null && die "the tag $tag exists: raise VERSION"
    [ -d "$INSTALL/.git" ] || die "the install repository is not at $INSTALL"
    git -C "$INSTALL" rev-parse -q --verify "refs/tags/$tag" >/dev/null && die "the tag $tag exists in the install repository: an earlier cut was left half done; undo it there first"
    [ -z "$(git -C "$INSTALL" status --porcelain)" ] || die "the install repository has changes that are not committed"
  fi

  # The clean checkout: this commit and nothing else.
  if ! git worktree list --porcelain | grep -qx "worktree $V"; then git worktree add -q --detach "$V" "$src"; fi
  git -C "$V" checkout -q -f --detach "$src"
  git -C "$V" clean -fdxq -e node_modules
  (
    cd "$V"
    "$BUN" install --frozen-lockfile >/dev/null
    for g in api settings reference tables; do "$BUN" run "$g" >/dev/null; done
    [ -z "$(git status --porcelain)" ] || { git status --short >&2; die "the generated documents are not current: run the four generators and commit"; }
    # The typecheck's own exit says nothing here (dev/preview is outside the build and may fail it), so its
    # lines are read: any error outside dev/preview refuses the build. It must have run to be believed.
    "$BUN" x tsc --version >/dev/null || die "the typecheck did not run"
    checked="$("$BUN" x tsc --noEmit -p . 2>&1 || true)"
    faults="$(printf '%s\n' "$checked" | grep -v '^dev/preview/' | grep 'error TS' || true)"
    [ -z "$faults" ] || { printf '%s\n' "$faults" | head -20 >&2; die "src does not typecheck"; }
    "$BUN" run build >/dev/null
    [ "$("$BUN" dist/rpe.js --version | head -1)" = "rpe $id" ] || die "the build does not say rpe $id"
    sums dist > "$V.sums-1"
    rm -rf dist
    "$BUN" run build >/dev/null
    sums dist > "$V.sums-2"
    cmp -s "$V.sums-1" "$V.sums-2" || die "two builds of the same commit differ"
    rm -f "$V.sums-1" "$V.sums-2"
  )

  # The tree Lumiverse installs: the built files, the manifest with this version, and what a reader needs.
  local tree="$V/.tree"
  rm -rf "$tree"; mkdir -p "$tree"
  cp -R "$V/dist" "$tree/dist"
  cp -R "$V/docs" "$tree/docs"
  cp "$V/README.md" "$V/NOTICE" "$V/THIRD-PARTY-NOTICES.md" "$tree/"
  RPE_VERSION="$version" RPE_SEMVER="$a.$b.$c+$d.$aa" "$BUN" -e '
    const dir = process.argv[1], out = process.argv[2];
    const manifest = JSON.parse(await Bun.file(dir + "/spindle.json").text());
    manifest.version = process.env.RPE_VERSION;
    await Bun.write(out + "/spindle.json", JSON.stringify(manifest, null, 2) + "\n");
    // No dependencies are declared: Lumiverse installs none for an extension whose built files are tracked.
    const pkg = JSON.parse(await Bun.file(dir + "/package.json").text());
    const lean = { name: pkg.name, version: process.env.RPE_SEMVER, private: true, type: pkg.type, engines: pkg.engines, bin: pkg.bin };
    await Bun.write(out + "/package.json", JSON.stringify(lean, null, 2) + "\n");
  ' "$V" "$tree"
  local files; files="$(find "$tree" -type f | wc -l | tr -d ' ')"
  say "built $version ($type) from $id: $files files, the build checked twice"
  if [ "$dry" = 1 ]; then say "dry run: the tree is in $tree; nothing was written elsewhere"; return 0; fi

  # Into the install repository, on the channel's branch.
  (
    cd "$INSTALL"
    # A channel's first build starts a branch with no history, so it holds built files and nothing else.
    if git rev-parse -q --verify "refs/heads/$channel" >/dev/null; then git switch -q "$channel"
    elif git rev-parse -q --verify "refs/remotes/origin/$channel" >/dev/null; then git switch -q -c "$channel" --track "origin/$channel"
    else git switch -q --orphan "$channel"; fi
    git rm -rqf --ignore-unmatch . >/dev/null
    git clean -fdq
    cp -R "$tree"/. .
    # Every file of the tree is committed, whatever an ignore rule on this machine says.
    (cd "$tree" && ls -A) | while read -r name; do git add -f -- "$name"; done
    [ "$(git ls-files | wc -l | tr -d ' ')" = "$files" ] || die "the commit would not hold every built file"
    git commit -q -m "RPE $version $type" -m "The built files of $src."
    git tag "$tag"
  )
  local built; built="$(git -C "$INSTALL" rev-parse "refs/heads/$channel")"
  git tag "$tag" "$src"
  printf 'TAG=%s\nCHANNEL=%s\nBRANCH=%s\nSRC=%s\nBUILT=%s\n' "$tag" "$channel" "$branch" "$src" "$built" > "$LAST"
  say "cut $tag on the channel $channel. Play it in the environment, then: scripts/release.sh publish"
}

case "${1:-}" in
  cut) shift; cut "$@" ;;
  publish) publish ;;
  *) die "usage: scripts/release.sh cut <alpha|beta|rc|stable> [--dry-run] | publish" ;;
esac
