#!/bin/bash
RELEASE=12.0
git tag --delete $RELEASE
git push --delete origin $RELEASE
echo v8 release $RELEASE >> CHANGELOG.md
git commit -a -m "v8 release $RELEASE"
git tag $RELEASE
git push origin main --force --tags
