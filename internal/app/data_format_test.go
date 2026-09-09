package app

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/WuKongIM/WuKongIM/pkg/cluster"
	"github.com/WuKongIM/WuKongIM/pkg/dataformat"
	"github.com/stretchr/testify/require"
)

func TestNewRegistersFreshDirectoryBeforeNestedLogger(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "data")
	cfg := Config{Cluster: cluster.Config{NodeID: 1, DataDir: dir, ListenAddr: "127.0.0.1:0"}, Log: LogConfig{Dir: filepath.Join(dir, "logs")}}
	build := dataformat.Build{Program: "wukongim", Version: "v3.identity", Commit: "creator-commit", BuildSource: "release"}
	a, err := New(isolatePluginRuntimeForTest(cfg), WithBuildIdentity(build))
	require.NoError(t, err)
	t.Cleanup(a.restoreDiagnosticsSink)
	defer a.Stop(context.Background())
	require.DirExists(t, cfg.Log.Dir)
	report, err := dataformat.Inspect(dir)
	require.NoError(t, err)
	require.Equal(t, "registered", report.Status)
	require.Equal(t, build, report.Metadata.CreatedBy)
}

func TestNewRejectsUnsupportedFormatBeforeNestedLogger(t *testing.T) {
	dir := t.TempDir()
	marker := []byte(`{"format":"wukongim-v3","format_version":999,"created_by":{"program":"wukongim","version":"future","commit":"future","build_source":"release"},"created_at":"2026-09-09T00:00:00Z"}`)
	require.NoError(t, os.WriteFile(filepath.Join(dir, dataformat.FileName), marker, 0600))
	cfg := Config{Cluster: cluster.Config{NodeID: 1, DataDir: dir, ListenAddr: "127.0.0.1:0"}, Log: LogConfig{Dir: filepath.Join(dir, "logs")}}
	a, err := New(isolatePluginRuntimeForTest(cfg))
	require.ErrorIs(t, err, dataformat.ErrUnsupported)
	require.Nil(t, a)
	entries, err := os.ReadDir(dir)
	require.NoError(t, err)
	require.Len(t, entries, 1)
	after, err := os.ReadFile(filepath.Join(dir, dataformat.FileName))
	require.NoError(t, err)
	require.Equal(t, marker, after)
}

func TestNewPropagatesCreatorIntoFreshDirectory(t *testing.T) {
	dir := t.TempDir()
	build := dataformat.Build{Program: "wukongim", Version: "v3.identity", Commit: "creator-commit", BuildSource: "release"}
	a, err := newTestApp(t, Config{Cluster: cluster.Config{NodeID: 1, DataDir: dir, ListenAddr: "127.0.0.1:0"}}, WithBuildIdentity(build))
	require.NoError(t, err)
	defer a.Stop(context.Background())
	report, err := dataformat.Inspect(dir)
	require.NoError(t, err)
	require.Equal(t, "registered", report.Status)
	require.Equal(t, build, report.Metadata.CreatedBy)
	require.Equal(t, build.Version, a.buildVersion)
}
