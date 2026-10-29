cask "pullshelf" do
  version "0.1.1"
  sha256 "af88f09267b50f957ef73fa19bda7f5a74d1de4226b20606c5158739634045f8"

  url "https://github.com/yogeshvar/pullshelf/releases/download/v#{version}/Pullshelf-#{version}-arm64.zip"
  name "Pullshelf"
  desc "Pull-down shelf for notes, clipboard history and terminals"
  homepage "https://pullself.vercel.app/"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on arch: :arm64
  depends_on macos: :ventura

  app "Pullshelf.app"

  zap trash: [
    "~/Library/Application Support/Pullshelf",
    "~/Library/Application Support/Perch",
    "~/Library/Application Support/Ledge",
    "~/Library/Preferences/io.github.yogeshvar.pullshelf.plist",
  ]

  caveats do
    unsigned_accessibility
    <<~EOS
      Pullshelf is ad-hoc signed and not notarized by Apple, so macOS blocks the first launch.
      Open System Settings -> Privacy & Security and click "Open Anyway" after the first
      attempt (macOS 15 and later). On macOS 13 and 14 you can instead right-click Pullshelf.app
      and choose Open. Or, on any version, run:

        xattr -dr com.apple.quarantine #{appdir}/Pullshelf.app

      The scroll gesture needs Accessibility access: System Settings -> Privacy & Security ->
      Accessibility, then switch Pullshelf on. macOS may ask for this again after an update.

      Press Command-Shift-L to open the shelf.
    EOS
  end
end
