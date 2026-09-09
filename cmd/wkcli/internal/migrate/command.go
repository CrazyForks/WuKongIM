package migrate

import (
	"context"
	"os"
	"os/signal"
	"syscall"

	"github.com/WuKongIM/WuKongIM/cmd/wkcli/internal/command"
	migrationapp "github.com/WuKongIM/WuKongIM/internal/app/migration"
	"github.com/spf13/cobra"
)

// NewCommand wires offline migration without changing its parser or exit codes.
func NewCommand(deps command.Deps) *cobra.Command {
	run := func(ctx context.Context, args []string) error {
		ctx, cancel := signal.NotifyContext(ctx, os.Interrupt, syscall.SIGTERM)
		defer cancel()
		if code := migrationapp.RunWithBuild(ctx, args, deps.Stdout, deps.Stderr, deps.Build); code != 0 {
			return command.Exit{Code: code}
		}
		return nil
	}
	cmd := &cobra.Command{
		Use:   "migrate",
		Short: "Migrate stopped original v2 databases to a native v3 cluster",
		// Pass the complete argument vector to the strict migration parser.
		// Cobra child traversal would discard flags placed before a verb.
		DisableFlagParsing: true,
		ValidArgs:          []string{"dedupe-plan", "authority", "diagnose", "prepare", "export", "export-map", "import", "verify"},
		RunE:               func(cmd *cobra.Command, args []string) error { return run(cmd.Context(), args) },
	}
	cmd.SetHelpFunc(func(cmd *cobra.Command, args []string) { _ = run(cmd.Context(), []string{"--help"}) })

	return cmd
}
