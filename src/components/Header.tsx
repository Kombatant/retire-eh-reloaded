import { Sun, Moon, Download, Upload, Share2, PiggyBank } from 'lucide-react'
import { PlanSwitcher } from './PlanSwitcher'
import { Tooltip } from './ui/Floating'

interface HeaderProps {
  isDarkMode: boolean
  showRealValues: boolean
  onToggleDarkMode: () => void
  onToggleRealValues: () => void
  onExport: () => void
  onImport: () => void
  onShare: () => void
}

export function Header({
  isDarkMode,
  showRealValues,
  onToggleDarkMode,
  onToggleRealValues,
  onExport,
  onImport,
  onShare
}: HeaderProps) {
  return (
    <header className="relative z-30 bg-white/80 dark:bg-gray-900/70 backdrop-blur-md border-b border-gray-200/70 dark:border-gray-700/70">
      <div className="px-4 py-4 sm:py-6 max-w-7xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary text-white shadow-sm">
              <PiggyBank className="w-6 h-6" />
            </div>
            <div className="text-left">
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">
                Retire, Eh?
              </h1>
              <p className="text-sm sm:text-base text-gray-500 dark:text-gray-400 mt-1">
                Canadian retirement planner
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <PlanSwitcher />
            <button
              onClick={onExport}
              className="flex items-center justify-center gap-2 h-10 px-3 text-sm font-medium rounded-lg border-2 transition-all bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-indigo-500 dark:hover:border-indigo-400"
              title="Export plan to YAML"
            >
              <Download className="w-4 h-4 shrink-0" /> <span className="hidden sm:inline">Export</span>
            </button>
            <button
              onClick={onImport}
              className="flex items-center justify-center gap-2 h-10 px-3 text-sm font-medium rounded-lg border-2 transition-all bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-indigo-500 dark:hover:border-indigo-400"
              title="Import plan from YAML"
            >
              <Upload className="w-4 h-4 shrink-0" /> <span className="hidden sm:inline">Import</span>
            </button>
            <button
              onClick={onShare}
              className="flex items-center justify-center gap-2 h-10 px-3 text-sm font-medium rounded-lg border-2 transition-all bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-indigo-500 dark:hover:border-indigo-400"
              title="Copy a share link to this plan"
            >
              <Share2 className="w-4 h-4 shrink-0" /> <span className="hidden sm:inline">Share</span>
            </button>
            <Tooltip
              prefer="below"
              align="end"
              className="w-72"
              content={showRealValues
                ? "Values shown in today's purchasing power, adjusted for inflation."
                : 'Future dollar amounts without inflation adjustment.'}
            >
              <button
                onClick={onToggleRealValues}
                className="flex items-center justify-center gap-2 h-10 px-3 text-sm font-medium rounded-lg border-2 transition-all bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-indigo-500 dark:hover:border-indigo-400"
              >
                <span className="sm:hidden">{showRealValues ? "Today's $" : 'Future $'}</span>
                <span className="hidden sm:inline">{showRealValues ? "Today's dollars" : 'Future dollars'}</span>
              </button>
            </Tooltip>
            <button
              onClick={onToggleDarkMode}
              className="flex items-center justify-center h-10 w-10 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors border-2 border-transparent"
              title={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>
    </header>
  )
}
