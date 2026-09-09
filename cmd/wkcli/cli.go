package main

import (
	"errors"
	"fmt"
	"io"
	"os"

	benchcmd "github.com/WuKongIM/WuKongIM/cmd/wkcli/internal/bench"
	fullbenchcmd "github.com/WuKongIM/WuKongIM/cmd/wkcli/internal/benchmark"
	"github.com/WuKongIM/WuKongIM/cmd/wkcli/internal/command"
	contextcmd "github.com/WuKongIM/WuKongIM/cmd/wkcli/internal/context"
	dbcmd "github.com/WuKongIM/WuKongIM/cmd/wkcli/internal/database"
	"github.com/WuKongIM/WuKongIM/cmd/wkcli/internal/diagnostics"
	migratecmd "github.com/WuKongIM/WuKongIM/cmd/wkcli/internal/migrate"
	nodeopscmd "github.com/WuKongIM/WuKongIM/cmd/wkcli/internal/nodeops"
	simcmd "github.com/WuKongIM/WuKongIM/cmd/wkcli/internal/sim"
	topcmd "github.com/WuKongIM/WuKongIM/cmd/wkcli/internal/top"
	"github.com/WuKongIM/WuKongIM/pkg/dataformat"
	"github.com/spf13/cobra"
)

const (
	exitOK          = command.ExitOK
	exitConfig      = command.ExitConfig
	exitUnavailable = command.ExitUnavailable
	exitInternal    = command.ExitInternal
)

func run(args []string) int {
	return runWithIO(args, os.Stdout, os.Stderr)
}

func runWithIO(args []string, stdout, stderr io.Writer) int {
	contextDir := contextcmd.DefaultStoreDir()
	deps := command.Deps{Build: dataformat.Build{Program: "wkcli", Version: buildVersion, Commit: buildCommit, BuildSource: buildSource}, Stdin: os.Stdin, Stdout: stdout, Stderr: stderr, ContextDir: &contextDir}
	cmd := newRootCommand(deps, defaultCommandFactories())
	// Only raw parser families need root flags consumed before their argument
	// vector is forwarded. Cobra families retain leaf flags before subcommands.
	if selected, _, err := cmd.Find(args); err == nil && selected.DisableFlagParsing {
		cmd.TraverseChildren = true
	}
	cmd.SetArgs(args)
	return executeCommand(cmd, stderr)
}

func executeCommand(cmd *cobra.Command, stderr io.Writer) int {
	if err := cmd.Execute(); err != nil {
		var exit command.Exit
		if errors.As(err, &exit) {
			if exit.Message != "" {
				fmt.Fprintln(stderr, exit.Message)
			}
			return exit.Code
		}
		var classified interface{ ExitCode() int }
		if errors.As(err, &classified) {
			if err.Error() != "" {
				fmt.Fprintln(stderr, err)
			}
			return classified.ExitCode()
		}
		fmt.Fprintln(stderr, err)
		return exitConfig
	}
	return exitOK
}

func newRootCommand(deps command.Deps, factories []command.Factory) *cobra.Command {
	cmd := &cobra.Command{
		Use:           "wkcli",
		Short:         "WuKongIM operational command line",
		SilenceUsage:  true,
		SilenceErrors: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			if err := cmd.Help(); err != nil {
				return command.Exit{Code: exitInternal, Message: err.Error()}
			}
			return command.Exit{Code: exitConfig}
		},
	}
	cmd.SetOut(deps.Stdout)
	cmd.SetErr(deps.Stderr)
	if deps.ContextDir != nil {
		cmd.PersistentFlags().StringVar(deps.ContextDir, "context-dir", *deps.ContextDir, "Directory for wkcli context files")
	}
	for _, factory := range factories {
		cmd.AddCommand(factory(deps))
	}
	return cmd
}

func defaultCommandFactories() []command.Factory {
	return []command.Factory{
		newVersionCommand,
		contextcmd.NewCommand,
		topcmd.NewCommand,
		newBenchCommand,
		dbcmd.NewCommand,
		migratecmd.NewCommand,
		simcmd.NewCommand,
		nodeopscmd.NewCommand,
	}
}

// newBenchCommand combines lightweight SEND testing and distributed scenarios.
func newBenchCommand(deps command.Deps) *cobra.Command {
	cmd := benchcmd.NewCommand(deps)
	full := fullbenchcmd.NewCommand(deps.Stderr)
	for _, child := range full.Commands() {
		if child.Name() == "report" {
			child.AddCommand(diagnostics.NewRedactionCommand())
		}
		cmd.AddCommand(child)
	}
	return cmd
}
