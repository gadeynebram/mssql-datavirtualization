# Release Process

This document describes how to release a new version of the MSSQL Data Virtualization Wizard extension.

## Pre-Release (Beta) Versions

Pre-release versions use **odd minor numbers** (e.g., `0.1.0`, `0.3.0`, `1.1.0`).

### Steps to Release a Pre-Release Version

1. **Update the version** in [package.json](package.json):
   ```bash
   # Manually edit package.json, set version to 0.1.x, 0.3.x, etc.
   ```

2. **Test locally**:
   ```bash
   npm install
   npm run compile
   npm run package
   ```
   
   This creates a `.vsix` file that you can test by installing it:
   - Open VS Code
   - Go to Extensions → `...` menu → Install from VSIX
   - Test the extension thoroughly

3. **Commit and create a tag**:
   ```bash
   git add package.json
   git commit -m "chore: bump version to 0.1.0"
   git push
   
   git tag v0.1.0
   git push origin v0.1.0
   ```

4. **Wait for GitHub Actions**:
   - Go to https://github.com/gadeynebram/mssql-datavirtualization/actions
   - The **Release** workflow will automatically:
     - Validate the tag matches package.json version
     - Detect it's a pre-release (odd minor number)
     - Build the VSIX
     - Create a GitHub Release marked as "Pre-release"
     - Attach the VSIX file

5. **Download and upload to Marketplace**:
   - Go to the GitHub Release
   - Download `mssql-datavirtualization-0.1.0.vsix`
   - Go to https://marketplace.visualstudio.com/manage/publishers/BramGadeyne
   - Upload the VSIX file manually
   - **Check "This is a pre-release version"** when uploading

## Stable Release Versions

Stable versions use **even minor numbers** (e.g., `0.2.0`, `0.4.0`, `1.0.0`).

### Steps to Release a Stable Version

1. **Update the version** in [package.json](package.json):
   ```bash
   # Manually edit package.json, set version to 0.2.x, 0.4.x, etc.
   ```

2. **Test locally** (same as pre-release)

3. **Commit and create a tag**:
   ```bash
   git add package.json
   git commit -m "chore: release version 0.2.0"
   git push
   
   git tag v0.2.0
   git push origin v0.2.0
   ```

4. **Wait for GitHub Actions**:
   - The Release workflow will create a standard GitHub Release (not marked as pre-release)

5. **Download and upload to Marketplace**:
   - Download the VSIX from GitHub Release
   - Upload to https://marketplace.visualstudio.com/manage/publishers/BramGadeyne
   - Do NOT check "This is a pre-release version"

## Versioning Convention

| Version Pattern | Type | Example | Use Case |
|----------------|------|---------|----------|
| `0.ODD.x` | Pre-release | `0.1.0`, `0.1.1`, `0.3.0` | Beta testing, new features |
| `0.EVEN.x` | Stable | `0.2.0`, `0.2.1`, `0.4.0` | Production-ready releases |
| `1.ODD.x` | Pre-release | `1.1.0`, `1.3.0` | Major version pre-releases |
| `1.EVEN.x` | Stable | `1.0.0`, `1.2.0` | Major version stable |

## Manual VSIX Creation

If you need to create a VSIX manually without GitHub Actions:

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Package into VSIX
npm run package

# This creates: mssql-datavirtualization-{version}.vsix
```

## Troubleshooting

### Version Mismatch Error

If GitHub Actions fails with "Version mismatch":
- Ensure the git tag (e.g., `v0.1.0`) matches the version in package.json (e.g., `0.1.0`)
- The tag should have a `v` prefix, but package.json should not

### CI Build Failures

Check the build locally first:
```bash
npm install
npm run compile
npm run package
```

### Marketplace Upload Issues

- Ensure you're logged in to https://marketplace.visualstudio.com with the correct account
- The publisher name must be **BramGadeyne** (case-sensitive)
- VSIX filename doesn't matter for manual upload

## Future Automation

Currently, marketplace upload is manual. To automate in the future:

1. Create a Personal Access Token at https://dev.azure.com:
   - Organization: "All accessible organizations"
   - Scope: "Marketplace (Manage)"

2. Add the PAT as a GitHub Secret named `VSCE_PAT`

3. Add this step to [.github/workflows/release.yml](.github/workflows/release.yml):
   ```yaml
   - name: Publish to Marketplace
     run: vsce publish -p ${{ secrets.VSCE_PAT }}
   ```
