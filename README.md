# install-binary

This action installs a binary from Github Releases:

- Automatically downloads and caches the binary, adding it to the PATH.
- Particularly useful for installing single-file binaries like most Go or Rust tools.      

## Inputs

| Name  | Required | Description      | Default               |
| ----- | -------- | ---------------- | --------------------- |
| repo  | **true** | The github repo  |                       |
| tag   | false    | The release tag  | latest                |
| name  | false    | The binary name  |                       |
| token | false    | The github token | `${{ github.token }}` |
| cache | false    | Use cache        | true                  |

## Examples

### Basic 

```yaml
# ...
steps:
  - uses: sigoden/install-binary@v0.1.0
    with:
      repo: sigoden/argc
```

### Specific tag and name

The `protocolbuffers/protobuf` repository has a binary named `protoc`, not `protobuf`.

```yaml
# ...
steps:
  - uses: sigoden/install-binary@v0.1.0
    with:
      repo: protocolbuffers/protobuf
      tag: v26.1
      name: protoc
```

The `WebAssembly/binaryen` repository has many binaries.  We only install a specific one based on the provided name option.

Specifying a name is helpful when the release includes multiple binaries.

```yaml
# ...
steps:
  - uses: sigoden/install-binary@v0.1.0
    with:
      repo: WebAssembly/binaryen
      name: wasm-opt
```

### Use a private repository
Use a repo scoped [Personal Access Token (PAT)](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens) that has been created on a user with access to the private repository.

```yaml
# ...
steps:
  - uses: sigoden/install-binary@v0.1.0
    with:
      repo: my-org/my-private-repo
      token: ${{ secrets.MY_PAT }}
```

## License

The scripts and documentation in this project are released under the MIT License