'use client'
import WorkspaceSwitcher from './WorkspaceSwitcher'

/** Logo + name only (used where there is no workspace yet, e.g. the sign-in form). */
export function Logo() {
  return (
      <div className="flex items-center gap-3 text-[17px] font-bold tracking-tight">
        <span className="relative inline-block h-[26px] w-[26px]" aria-hidden="true">
          <i className="absolute left-0 top-[2px] h-[13px] w-[13px] rounded-sm bg-blue" />
          <i className="absolute right-0 top-0 h-[10px] w-[10px] rounded-sm bg-orange" />
          <i className="absolute bottom-0 right-[1px] h-[12px] w-[12px] rounded-sm bg-purple" />
          <i className="absolute bottom-[1px] left-[3px] h-[8px] w-[8px] rounded-sm bg-teal" />
        </span>
        Back Office
      </div>
  )
}

/** Logo + project selector, shared by every page header (selector sits to the right of the logo). */
export default function Brand() {
  return (
    <div className="flex items-center gap-3">
      <Logo />
      <WorkspaceSwitcher />
    </div>
  )
}
