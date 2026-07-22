import { cn } from '@/lib/utils'
import { InputHTMLAttributes, forwardRef, useId } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  hint?: string
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, hint, id, ...props }, ref) => {
    // label과 input이 프로그램적으로 연결돼 있지 않으면 스크린리더가 입력칸의
    // 이름을 못 읽고, 라벨을 눌러도 포커스가 안 간다. 공용 컴포넌트라
    // 여기서 한 번 이어주면 앱 전체에 적용된다. (호출부가 id를 주면 그걸 존중)
    const autoId = useId()
    const inputId = id ?? autoId
    const hintId = `${inputId}-hint`
    const errorId = `${inputId}-error`
    const describedBy = error ? errorId : hint ? hintId : undefined

    return (
      <div className="w-full">
        {label && (
          <label htmlFor={inputId} className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            'w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 placeholder-gray-400',
            'dark:border-gray-700 dark:bg-gray-900 dark:text-white dark:placeholder-gray-500',
            'transition-all duration-200 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20',
            error && 'border-red-400 focus:border-red-500 focus:ring-red-500/20',
            className
          )}
          {...props}
        />
        {hint && !error && <p id={hintId} className="mt-1 text-xs text-gray-500 dark:text-gray-500">{hint}</p>}
        {error && <p id={errorId} className="mt-1 text-xs text-red-600">{error}</p>}
      </div>
    )
  }
)

Input.displayName = 'Input'
export { Input }
