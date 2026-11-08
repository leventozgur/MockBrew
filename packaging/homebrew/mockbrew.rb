class Mockbrew < Formula
  desc "Offline mock API studio for mobile development"
  homepage "https://github.com/OWNER/REPO"
  version "VERSION"
  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/OWNER/REPO/releases/download/v#{version}/mockbrew-macos-arm64"
      sha256 "SHA256_MACOS_ARM64"
    else
      url "https://github.com/OWNER/REPO/releases/download/v#{version}/mockbrew-macos-x64"
      sha256 "SHA256_MACOS_X64"
    end
  end
  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/OWNER/REPO/releases/download/v#{version}/mockbrew-linux-arm64"
      sha256 "SHA256_LINUX_ARM64"
    else
      url "https://github.com/OWNER/REPO/releases/download/v#{version}/mockbrew-linux-x64"
      sha256 "SHA256_LINUX_X64"
    end
  end
  def install
    bin.install Dir["mockbrew-*"].first => "mockbrew"
  end
end
