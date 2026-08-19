'use client'

import { useState, useTransition, useRef } from 'react'
import { updateKodZakaMsmt } from '@/app/actions/students'

interface StudentRow {
  id: string
  kod_zaka: string
  first_name: string
  last_name: string
  birth_date: string
  kod_zaka_msmt: string | null
}

interface Props {
  student: StudentRow
}

type Status = 'idle' | 'saving' | 'saved' | 'error'

export function KodZakaMsmtRow({ student }: Props) {
  const [value, setValue] = useState(student.kod_zaka_msmt ?? '')
  const [status, setStatus] = useState<Status>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [isPending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  // Původní hodnota pro detekci změny
  const originalValue = student.kod_zaka_msmt ?? ''

  const isDirty = value !== originalValue
  const isFilled = value.length === 10

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Auto-strip lomítko při vkládání rodného čísla ve formátu 170501/1341
    const raw = e.target.value.replace(/\//g, '').replace(/\D/g, '')
    setValue(raw.slice(0, 10))
    setStatus('idle')
    setErrorMsg('')
  }

  const save = () => {
    // Neukladáme pokud se nic nezměnilo
    if (!isDirty) return

    startTransition(async () => {
      setStatus('saving')
      const result = await updateKodZakaMsmt(student.id, value)
      if ('error' in result) {
        setStatus('error')
        setErrorMsg(result.error)
      } else {
        setStatus('saved')
        setTimeout(() => setStatus('idle'), 2500)
      }
    })
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      inputRef.current?.blur()
      save()
    }
    if (e.key === 'Escape') {
      setValue(originalValue)
      setStatus('idle')
      setErrorMsg('')
      inputRef.current?.blur()
    }
  }

  const statusIcon = () => {
    if (status === 'saving' || isPending) {
      return (
        <span className="text-gray-400 text-xs animate-pulse">ukládám…</span>
      )
    }
    if (status === 'saved') {
      return <span className="text-green-600 text-xs font-medium">✓ uloženo</span>
    }
    if (status === 'error') {
      return (
        <span className="text-red-500 text-xs" title={errorMsg}>
          ✗ {errorMsg}
        </span>
      )
    }
    if (!isFilled && !isDirty) {
      return <span className="text-red-400 text-xs">chybí</span>
    }
    if (isFilled && !isDirty) {
      return <span className="text-green-500 text-xs">✓</span>
    }
    if (isDirty) {
      return <span className="text-amber-500 text-xs">neuloženo</span>
    }
    return null
  }

  const inputBorder = () => {
    if (status === 'error') return 'border-red-400 bg-red-50'
    if (status === 'saved') return 'border-green-400 bg-green-50'
    if (isFilled && !isDirty) return 'border-green-300 bg-green-50/50'
    if (!value && !isDirty) return 'border-red-200 bg-red-50/30'
    return 'border-gray-300 bg-white'
  }

  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
      {/* kod_zaka */}
      <td className="px-3 py-2 font-mono text-xs text-gray-500 whitespace-nowrap">
        {student.kod_zaka}
      </td>

      {/* Jméno */}
      <td className="px-3 py-2 text-sm font-medium text-gray-800 whitespace-nowrap">
        {student.last_name} {student.first_name}
      </td>

      {/* Datum narození */}
      <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">
        {student.birth_date}
      </td>

      {/* Input kod_zaka_msmt */}
      <td className="px-3 py-2">
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          value={value}
          onChange={handleChange}
          onBlur={save}
          onKeyDown={handleKeyDown}
          maxLength={10}
          placeholder="0000000000"
          disabled={isPending}
          className={`
            w-32 px-2 py-1 rounded border text-sm font-mono tracking-wider
            focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400
            disabled:opacity-50 transition-colors
            ${inputBorder()}
          `}
        />
      </td>

      {/* Stav */}
      <td className="px-3 py-2 min-w-[6rem]">
        {statusIcon()}
      </td>
    </tr>
  )
}
