package app

import (
	"context"
	"testing"

	"github.com/WuKongIM/WuKongIM/pkg/cluster"
	"github.com/WuKongIM/WuKongIM/pkg/dataformat"
	"github.com/stretchr/testify/require"
)

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
