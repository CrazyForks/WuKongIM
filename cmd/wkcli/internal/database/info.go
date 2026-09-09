package database

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/WuKongIM/WuKongIM/pkg/dataformat"
)

// runInfo reads only directory identity; it never opens a database or creates paths.
func runInfo(flags cliFlags, args []string, stdout, stderr io.Writer) int {
	if len(args) != 0 || flags.metaPath != "" || flags.messagePath != "" || flags.hashSlotCount != 0 {
		fmt.Fprintln(stderr, "info requires a node data directory, without store overrides or extra arguments")
		return exitConfig
	}
	values, err := loadCLIValues(flags.configPath, os.Environ())
	if err != nil {
		fmt.Fprintln(stderr, err)
		return exitConfig
	}
	dir := firstNonEmpty(strings.TrimSpace(flags.dataDir), values["WK_NODE_DATA_DIR"])
	if dir == "" {
		fmt.Fprintln(stderr, "info requires --data-dir, node.data_dir in --config, or WK_NODE_DATA_DIR")
		return exitConfig
	}
	report, err := dataformat.Inspect(dir)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return exitConfig
	}
	switch flags.format {
	case "json", "jsonl":
		enc := json.NewEncoder(stdout)
		if flags.format == "json" {
			enc.SetIndent("", "  ")
		}
		err = enc.Encode(report)
	case "table":
		_, err = fmt.Fprintf(stdout, "status: %s\n", report.Status)
		if err == nil && report.Metadata != nil {
			m := report.Metadata
			_, err = fmt.Fprintf(stdout, "format: %s\nformat_version: %d\ncreated_by: %s version=%s commit=%s source=%s\ncreated_at: %s\n", m.Format, m.FormatVersion, m.CreatedBy.Program, m.CreatedBy.Version, m.CreatedBy.Commit, m.CreatedBy.BuildSource, m.CreatedAt.Format("2006-01-02T15:04:05.999999999Z07:00"))
		}
	default:
		fmt.Fprintln(stderr, "info format must be table, json, or jsonl")
		return exitConfig
	}
	if err != nil {
		fmt.Fprintln(stderr, err)
		return exitInternal
	}
	return exitOK
}
