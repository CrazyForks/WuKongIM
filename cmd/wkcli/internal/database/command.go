package database

import (
	"fmt"
	"io"

	"github.com/WuKongIM/WuKongIM/cmd/wkcli/internal/command"
	"github.com/spf13/cobra"
)

// NewCommand preserves the database parser's global-flags-before-verb grammar.
func NewCommand(deps command.Deps) *cobra.Command {
	cmd := &cobra.Command{
		Use:                "db [flags] <info|query|repl|import|export|diff>",
		Short:              "Inspect, import, export and compare offline databases",
		DisableFlagParsing: true,
		ValidArgs:          []string{"info", "query", "repl", "import", "export", "diff"},
		RunE: func(cmd *cobra.Command, args []string) error {
			if len(args) == 2 && (args[1] == "--help" || args[1] == "-h") && printVerbHelp(args[0], deps.Stdout) {
				return nil
			}
			if len(args) == 1 && (args[0] == "--help" || args[0] == "-h" || args[0] == "help") {
				cmd.HelpFunc()(cmd, args)
				return nil
			}
			code := runWithBuild(args, deps.Stdin, deps.Stdout, deps.Stderr, deps.Build)
			if code != 0 {
				return command.Exit{Code: code}
			}
			return nil
		},
	}
	cmd.SetHelpFunc(func(cmd *cobra.Command, args []string) {
		_, _, _ = parseFlags([]string{"--help"}, deps.Stdout)
	})
	return cmd
}

// printVerbHelp describes an operation without opening source or target stores.
func printVerbHelp(verb string, out io.Writer) bool {
	switch verb {
	case "info":
		fmt.Fprintln(out, "Usage: wkcli db --data-dir /path/to/data [--format json] info\nRead DATA-FORMAT.json without opening the database; old directories remain unregistered.")
	case "query":
		fmt.Fprintln(out, "Usage: wkcli db [global flags] query <sql>")
	case "repl":
		fmt.Fprintln(out, "Usage: wkcli db [global flags] repl\nRead SQL from stdin; exit or quit ends the session.")
	case "import":
		fmt.Fprintln(out, "Usage: wkcli db [global flags] import [flags]")
		_, _ = parseImportCommandFlags([]string{"--help"}, out)
	case "export":
		fmt.Fprintln(out, "Usage: wkcli db [global flags] export [flags]")
		_, _ = parseExportCommandFlags([]string{"--help"}, out)
	case "diff":
		fmt.Fprintln(out, "Usage: wkcli db [global flags] diff [flags]")
		_, _ = parseDiffCommandFlags([]string{"--help"}, out)
	default:
		return false
	}
	return true
}
