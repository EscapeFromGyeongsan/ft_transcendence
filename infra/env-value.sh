# shellcheck shell=sh
# Sourced by prepare-full.sh and start-full.sh with env_file set.
# Reads a setting the way Compose interpolates it: the environment first, then
# the env file. In the file, a quoted value ends at its closing quote (anything
# after it, such as a comment, is ignored) and an unquoted value ends before
# " #". Trailing spaces are removed.

# Prints KEY from the env file (empty if unset).
file_value() {
  awk -v key="$1" '
    index($0, key "=") == 1 {
      v = substr($0, length(key) + 2)
      q = substr(v, 1, 1)
      if (q == "\"" || q == "\047") {
        rest = substr(v, 2)
        end = index(rest, q)
        v = end ? substr(rest, 1, end - 1) : rest
      } else {
        c = index(v, " #")
        if (c) v = substr(v, 1, c - 1)
        sub(/[ \t]+$/, "", v)
      }
      found = v
    }
    END { print found }
  ' "${env_file:?}"
}

# Prints KEY from the environment, or from the env file when it is not set.
value_of() {
  printenv "$1" || file_value "$1"
}
