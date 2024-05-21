# install-binary

[![CI](https://img.shields.io/github/actions/workflow/status/sigoden/aichat/ci.yaml)](https://github.com/sigoden/install-binary/actions/workflows/ci.yml)
[![GitHub Release](https://img.shields.io/github/v/release/sigoden/install-binary)](https://github.com/sigoden/install-binary/releases)

This action installs a binary from Github Releases:

- Automatically downloads and caches the binary, adding it to the PATH.
- Supports specific release tags and binary names.
- Particularly useful for installing single-file binaries such as those developed with Go or Rust.

## Inputs

| Name    | Required | Description                                   | Default               |
| ------- | -------- | --------------------------------------------- | --------------------- |
| `repo`  | **true** | The GitHub repository in `owner/repo` format  |                       |
| `tag`   | false    | The release tag to download                   | `latest`              |
| `name`  | false    | The specific binary name within the release   |                       |
| `token` | false    | GitHub token, useful for private repositories | `${{ github.token }}` |
| `cache` | false    | Controls whether the binary is cached         | `true`                |

## Usage Examples

### Basic Installation

Install the latest binary from a public GitHub repository.

```yaml
# ...
steps:
  - uses: sigoden/install-binary@v1
    with:
      repo: sigoden/argc
```

### Installing a Binary with a Specific Tag and Name

Install a specific binary (`protoc`) from a given release tag (`v26.1`) in the `protocolbuffers/protobuf` repository.

```yaml
# ...
steps:
  - uses: sigoden/install-binary@v1
    with:
      repo: protocolbuffers/protobuf
      tag: v26.1
      name: protoc
```

Install a specific binary (`wasm-opt`) from the `WebAssembly/binaryen` repository, which contains multiple binaries.

```yaml
# ...
steps:
  - uses: sigoden/install-binary@v1
    with:
      repo: WebAssembly/binaryen
      name: wasm-opt
```

### Using a Private Repository

Install a binary from a private repository using a [Personal Access Token (PAT)](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens).

```yaml
# ...
steps:
  - uses: sigoden/install-binary@v1
    with:
      repo: my-org/my-private-repo
      token: ${{ secrets.MY_PAT }}
```

## License

The scripts and documentation in this project are released under the MIT License