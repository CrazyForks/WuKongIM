package dataformat

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestFreshIdentitySurvivesUpgradeAndDirectoryCopy(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "node")
	build := Build{Program: "wukongim", Version: "v3.test", Commit: "commit-a", BuildSource: "release"}
	require.NoError(t, EnsureFresh(dir, build))
	before, err := os.ReadFile(filepath.Join(dir, FileName))
	require.NoError(t, err)
	require.NoError(t, EnsureFresh(dir, Build{Version: "newer"}))
	require.NoError(t, InitializeOwned(dir, Build{Version: "newer"}))
	after, err := os.ReadFile(filepath.Join(dir, FileName))
	require.NoError(t, err)
	require.Equal(t, before, after)
	report, err := Inspect(dir)
	require.NoError(t, err)
	require.Equal(t, "registered", report.Status)
	require.Equal(t, build, report.Metadata.CreatedBy)
	copyDir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(copyDir, FileName), before, 0600))
	copied, err := Inspect(copyDir)
	require.NoError(t, err)
	require.Equal(t, report, copied)
	entries, err := os.ReadDir(dir)
	require.NoError(t, err)
	require.Len(t, entries, 1)
}

func TestHistoricalAndExternalDataStayUnregistered(t *testing.T) {
	for _, external := range []bool{false, true} {
		dir := t.TempDir()
		old := dir
		if external {
			old = t.TempDir()
		}
		require.NoError(t, os.WriteFile(filepath.Join(old, "old-data"), []byte("preserve"), 0600))
		require.NoError(t, EnsureFresh(dir, Build{}, old))
		report, err := Inspect(dir)
		require.NoError(t, err)
		require.Equal(t, "unregistered", report.Status)
		require.Nil(t, report.Metadata)
		require.NoError(t, Check(dir))
		_, err = os.Stat(filepath.Join(dir, FileName))
		require.True(t, os.IsNotExist(err))
	}
	missing := filepath.Join(t.TempDir(), "missing")
	_, err := Inspect(missing)
	require.True(t, os.IsNotExist(err))
	_, err = os.Stat(missing)
	require.True(t, os.IsNotExist(err))
}

func TestUnsupportedAndMalformedIdentityFailsClosed(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, EnsureFresh(dir, Build{}))
	marker := filepath.Join(dir, FileName)
	valid, err := os.ReadFile(marker)
	require.NoError(t, err)
	future := strings.Replace(string(valid), `"format_version": 1`, `"format_version": 999`, 1)
	require.NoError(t, os.WriteFile(marker, []byte(future), 0600))
	report, err := Inspect(dir)
	require.NoError(t, err)
	require.Equal(t, "unsupported", report.Status)
	require.ErrorIs(t, Check(dir), ErrUnsupported)
	require.ErrorIs(t, InitializeOwned(dir, Build{}), ErrUnsupported)
	unchanged, err := os.ReadFile(marker)
	require.NoError(t, err)
	require.Equal(t, future, string(unchanged))
	for _, bad := range []string{"{}", string(valid) + "{}", strings.Repeat("x", maxBytes+1), strings.Replace(string(valid), `"format_version": 1`, `"format_version": 0`, 1)} {
		require.NoError(t, os.WriteFile(marker, []byte(bad), 0600))
		require.Error(t, Check(dir))
	}
	require.NoError(t, os.Remove(marker))
	target := filepath.Join(t.TempDir(), "marker")
	require.NoError(t, os.WriteFile(target, valid, 0600))
	require.NoError(t, os.Symlink(target, marker))
	require.Error(t, Check(dir))
	require.False(t, errors.Is(Check(dir), os.ErrNotExist))
}
